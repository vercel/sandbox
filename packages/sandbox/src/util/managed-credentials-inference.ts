import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { CliError } from "./cli-error";
import { isRepository, repositoryFromUrl } from "./managed-credentials-config";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5_000;
const GH_TIMEOUT_MS = 10_000;
const VERCEL_TIMEOUT_MS = 10_000;

export interface CommitIdentity {
  name: string;
  email: string;
}

/** Where an inferred value came from, so review can show its provenance. */
export type IdentitySource =
  | "explicit"
  | "git-config"
  | "gh"
  | "vercel-account-link";

export interface InferredActor {
  /** The value sent to the API: `@login` or an immutable numeric ID. */
  actAs: string;
  /** A readable login for display, when one is known. */
  login?: string;
  source: IdentitySource;
  /**
   * Profile metadata discovered alongside the actor.
   *
   * Lets the commit-identity fallback reuse this lookup instead of querying
   * again. Metadata only: never a credential.
   */
  profile?: {
    name?: string;
    email?: string;
    id?: string;
    login?: string;
  };
}

/** What a helper command reported, keeping "absent" distinct from "failed". */
type CommandResult =
  | { status: "ok"; stdout: string }
  | { status: "absent" }
  | { status: "failed"; stderr: string };

/**
 * Run a read-only helper command.
 *
 * A missing binary is "absent"; anything else that goes wrong is "failed".
 * Collapsing the two would let a network blip or an expired token look like
 * "this tool has no answer", which for identity lookups means silently
 * continuing as a different user. Nothing here retrieves a credential; only
 * metadata is read.
 */
async function runCommand(
  file: string,
  args: string[],
  timeout: number,
  cwd?: string,
): Promise<CommandResult> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout,
      ...(cwd ? { cwd } : {}),
    });
    return { status: "ok", stdout: stdout.trim() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { status: "absent" };
    const stderr = (error as { stderr?: unknown } | undefined)?.stderr;
    return {
      status: "failed",
      stderr: typeof stderr === "string" ? stderr : "",
    };
  }
}

/**
 * Run a read-only helper command, returning `undefined` when it is absent or
 * fails.
 *
 * Used where no answer is simply no answer — a repository or commit identity
 * that cannot be read is reported to the user as missing context rather than
 * substituted. Identity lookups use {@link runCommand} directly instead.
 */
async function readCommand(
  file: string,
  args: string[],
  timeout: number,
  cwd?: string,
): Promise<string | undefined> {
  const result = await runCommand(file, args, timeout, cwd);
  if (result.status !== "ok") return undefined;
  return result.stdout.length > 0 ? result.stdout : undefined;
}

/**
 * Infer the repository from the local Git remotes, preferring `origin`.
 *
 * Only HTTPS and SSH github.com remotes are recognized. A repository being
 * present is never on its own a reason to enable managed credentials; the
 * caller decides that from the flags.
 */
export async function inferRepository(
  cwd = process.cwd(),
): Promise<string | undefined> {
  const inside = await readCommand(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    GIT_TIMEOUT_MS,
    cwd,
  );
  if (inside !== "true") return undefined;

  const remotes = await readCommand(
    "git",
    ["remote", "-v"],
    GIT_TIMEOUT_MS,
    cwd,
  );
  if (!remotes) return undefined;

  const parsed = new Map<string, string>();
  for (const line of remotes.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (!match) continue;
    const repo = repositoryFromRemote(match[2]);
    if (repo && !parsed.has(match[1])) parsed.set(match[1], repo);
  }
  if (parsed.size === 0) return undefined;
  return parsed.get("origin") ?? [...parsed.values()][0];
}

/** Accept the HTTPS, SSH, and `git@` spellings of a github.com remote. */
export function repositoryFromRemote(value: string): string | undefined {
  const https = repositoryFromUrl(value);
  if (https) return https;
  const ssh =
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(
      value,
    );
  if (!ssh) return undefined;
  const repo = `${ssh[1]}/${ssh[2]}`;
  return isRepository(repo) ? repo : undefined;
}

/**
 * Read the effective Git commit identity for the working directory.
 *
 * Uses plain `git config` rather than `--global` so a repository-local
 * `user.email` override wins, which is what a contributor who sets a
 * per-repository identity expects.
 */
export async function inferCommitIdentity(
  cwd = process.cwd(),
): Promise<CommitIdentity | undefined> {
  const [name, email] = await Promise.all([
    readCommand("git", ["config", "--get", "user.name"], GIT_TIMEOUT_MS, cwd),
    readCommand("git", ["config", "--get", "user.email"], GIT_TIMEOUT_MS, cwd),
  ]);
  if (!name || !email) return undefined;
  return { name, email };
}

/** Parse `--credentials-commit-as "Name <email>"`. */
export function parseCommitAs(value: string): CommitIdentity {
  const match = /^\s*(.+?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(value);
  if (!match) {
    throw new CliError(
      '--credentials-commit-as expects "Name <email@example.com>".',
    );
  }
  const [, name, email] = match;
  if (!name.trim()) {
    throw new CliError(
      '--credentials-commit-as requires a name before the email, as in "Ada Lovelace <ada@example.com>".',
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new CliError(
      `--credentials-commit-as requires a valid email address. Received: ${email}`,
    );
  }
  return { name: name.trim(), email };
}

const ghUserSchema = z.object({
  login: z.string().min(1),
  id: z.number().int().positive().optional(),
  name: z.string().nullish(),
  email: z.string().nullish(),
});

export interface GhAccount {
  login: string;
  id?: number;
  name?: string;
  email?: string;
}

/**
 * Read the active `gh` account through read-only metadata commands.
 *
 * Returns `undefined` only when `gh` is absent or not logged in. A transient
 * failure of a logged-in `gh` is reported as an error instead, so the CLI
 * never silently falls through to a different identity after a network blip.
 */
export async function readGhAccount(): Promise<GhAccount | undefined> {
  // Pin the host: a user logged in only to a GitHub Enterprise instance must
  // not have that host's account treated as their github.com identity.
  const status = await runCommand(
    "gh",
    ["auth", "status", "--hostname", "github.com"],
    GH_TIMEOUT_MS,
  );
  if (status.status === "absent") return undefined;
  if (status.status === "failed") {
    // Only "not logged in" means there is no gh answer. Any other failure —
    // an unreachable API, an expired token, a broken install — must stop the
    // command rather than hand the request to a different identity.
    if (
      /not logged in|no accounts|lacks required scopes/i.test(status.stderr)
    ) {
      return undefined;
    }
    throw new CliError(
      "gh could not report its github.com account. Re-run once gh is working, or pass --credentials-act-as explicitly. The CLI does not fall back to another identity after a gh failure.",
      { reason: "identity_lookup_failed" },
    );
  }

  const user = await runCommand(
    "gh",
    [
      "api",
      "user",
      "--hostname",
      "github.com",
      "--jq",
      "{login: .login, id: .id, name: .name, email: .email}",
    ],
    GH_TIMEOUT_MS,
  );
  if (user.status !== "ok" || user.stdout.length === 0) {
    throw new CliError(
      "gh is logged in but `gh api user` failed. Re-run once gh can reach GitHub, or pass --credentials-act-as explicitly. The CLI does not fall back to another identity after a gh failure.",
      { reason: "identity_lookup_failed" },
    );
  }
  const raw = user.stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(
      "Could not read the active GitHub account from gh. Pass --credentials-act-as explicitly.",
      { reason: "identity_lookup_failed" },
    );
  }
  const result = ghUserSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(
      "gh returned an unexpected account document. Pass --credentials-act-as explicitly.",
      { reason: "identity_lookup_failed" },
    );
  }
  const { login, id, name, email } = result.data;
  return {
    login,
    ...(id !== undefined ? { id } : {}),
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  };
}

/**
 * The GitHub connection Vercel has on file for the authenticated user.
 *
 * Only the default github.com OAuth login connection counts. Another provider,
 * an enterprise host, a limited connection, or an ambiguous list is treated as
 * "unknown", never as the intended identity.
 */
export interface VercelGithubLink {
  login?: string;
  id?: string;
  name?: string;
  email?: string;
}

const accountLinkSchema = z.object({
  provider: z.string().optional(),
  type: z.string().optional(),
  host: z.string().nullish(),
  origin: z.string().nullish(),
  login: z.string().nullish(),
  loginName: z.string().nullish(),
  username: z.string().nullish(),
  userId: z.union([z.string(), z.number()]).nullish(),
  providerUserId: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish(),
  email: z.string().nullish(),
});

const accountLinksSchema = z.union([
  z.object({ accountLinks: z.array(accountLinkSchema) }),
  z.array(accountLinkSchema),
]);

/**
 * Query Vercel's linked GitHub identity.
 *
 * Only consulted when `gh` is not logged in. Uses the existing CLI token
 * against the documented account-links endpoint and never requests a GitHub
 * token.
 */
export async function readVercelGithubLink(options: {
  token: string;
  teamId?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<VercelGithubLink | undefined> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const url = new URL("https://vercel.com/api/v1/integrations/account-links");
  if (options.teamId) url.searchParams.set("teamId", options.teamId);

  let response: Response;
  try {
    response = await doFetch(url, {
      headers: { Authorization: `Bearer ${options.token}` },
      signal: options.signal ?? AbortSignal.timeout(VERCEL_TIMEOUT_MS),
    });
  } catch {
    // A failed lookup is unknown, not an empty policy and not permission to
    // pick a different account.
    throw new CliError(
      "Could not reach Vercel to resolve the linked GitHub account. Pass --credentials-act-as explicitly, or log in with gh.",
      { reason: "identity_lookup_failed" },
    );
  }
  if (!response.ok) {
    throw new CliError(
      `Vercel could not resolve a linked GitHub account (HTTP ${response.status}). Pass --credentials-act-as explicitly, or log in with gh.`,
      { reason: "identity_lookup_failed" },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliError(
      "Vercel returned an unreadable account-links document. Pass --credentials-act-as explicitly.",
      { reason: "identity_lookup_failed" },
    );
  }
  const parsed = accountLinksSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const links = Array.isArray(parsed.data)
    ? parsed.data
    : parsed.data.accountLinks;

  const candidates = links.filter((link) => {
    const provider = (link.provider ?? link.origin ?? "").toLowerCase();
    if (provider !== "github") return false;
    // Reject enterprise hosts: only the default github.com connection is the
    // identity the broker will recognize.
    const host = (link.host ?? "").toLowerCase();
    if (host && host !== "github.com") return false;
    // A "limited" or otherwise non-login connection cannot act as a user.
    const type = (link.type ?? "login").toLowerCase();
    return type === "login";
  });

  // An ambiguous list is not an answer. Requiring an explicit override is
  // safer than guessing which of several accounts the user meant.
  if (candidates.length !== 1) return undefined;

  const link = candidates[0];
  const login = link.login ?? link.loginName ?? link.username ?? undefined;
  const rawId = link.providerUserId ?? link.userId ?? undefined;
  const id =
    rawId === undefined || rawId === null
      ? undefined
      : typeof rawId === "number"
        ? Number.isSafeInteger(rawId) && rawId > 0
          ? String(rawId)
          : undefined
        : /^[1-9][0-9]*$/.test(rawId)
          ? rawId
          : undefined;
  return {
    ...(login ? { login } : {}),
    ...(id ? { id } : {}),
    ...(link.name ? { name: link.name } : {}),
    ...(link.email ? { email: link.email } : {}),
  };
}

/**
 * Resolve the GitHub API actor.
 *
 * Precedence is explicit value, then `gh`, then Vercel's linked account. The
 * Vercel endpoint is only consulted when `gh` is not logged in, so a logged-in
 * `gh` is authoritative even if Vercel has a different account on file.
 */
export async function inferActor(options: {
  explicit?: string;
  token: string;
  teamId?: string;
  fetch?: typeof globalThis.fetch;
  readGh?: typeof readGhAccount;
  readVercel?: typeof readVercelGithubLink;
}): Promise<InferredActor | undefined> {
  if (options.explicit !== undefined) {
    const value = options.explicit.trim();
    const actAs = /^[0-9]+$/.test(value)
      ? value
      : value.startsWith("@")
        ? value
        : `@${value}`;
    return {
      actAs,
      ...(actAs.startsWith("@") ? { login: actAs.slice(1) } : {}),
      source: "explicit",
    };
  }

  const gh = await (options.readGh ?? readGhAccount)();
  if (gh) {
    // Prefer the immutable numeric ID for authorization while showing the
    // readable login, so a later rename cannot redirect the grant.
    return {
      actAs: gh.id !== undefined ? String(gh.id) : `@${gh.login}`,
      login: gh.login,
      source: "gh",
      profile: {
        ...(gh.name ? { name: gh.name } : {}),
        ...(gh.email ? { email: gh.email } : {}),
        ...(gh.id !== undefined ? { id: String(gh.id) } : {}),
        login: gh.login,
      },
    };
  }

  const link = await (options.readVercel ?? readVercelGithubLink)({
    token: options.token,
    ...(options.teamId ? { teamId: options.teamId } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (!link) return undefined;
  if (link.id === undefined && link.login === undefined) return undefined;
  return {
    actAs: link.id ?? `@${link.login}`,
    ...(link.login ? { login: link.login } : {}),
    source: "vercel-account-link",
    profile: {
      ...(link.name ? { name: link.name } : {}),
      ...(link.email ? { email: link.email } : {}),
      ...(link.id ? { id: link.id } : {}),
      ...(link.login ? { login: link.login } : {}),
    },
  };
}

/**
 * Derive a commit identity from connected profile metadata.
 *
 * Mirrors the server-side `resolveGitIdentity` fallback so a Sandbox created
 * from the CLI credits commits the same way the Devbox path does. Returns
 * `undefined` rather than fabricating an identity when the metadata needed is
 * not available.
 */
export function commitIdentityFromProfile(profile: {
  githubName?: string;
  githubLogin?: string;
  githubId?: string | number;
  githubEmail?: string;
  vercelName?: string;
  vercelUsername?: string;
  vercelEmail?: string;
}): CommitIdentity | undefined {
  const name =
    profile.githubName ||
    profile.githubLogin ||
    profile.vercelName ||
    profile.vercelUsername;

  const email =
    profile.githubId !== undefined && profile.githubLogin
      ? `${profile.githubId}+${profile.githubLogin}@users.noreply.github.com`
      : profile.githubEmail || profile.vercelEmail;

  if (!name || !email) return undefined;
  return { name, email };
}
