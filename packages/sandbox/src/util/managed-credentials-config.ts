import {
  GITHUB_API_CREDENTIAL_ACTIONS,
  MANAGED_GIT_ACTIONS,
} from "@vercel/sandbox";
import { z } from "zod";
import { CliError } from "./cli-error";

/**
 * The logical managed-credentials configuration model.
 *
 * This is the shape the CLI reasons about, reviews, and persists. It is
 * deliberately separate from the Sandbox API transport, which splits the same
 * information across `source`, `commitAs`, and `credentials.github[]` with
 * different field names. `managed-credentials-transport.ts` adapts between the
 * two, so transport quirks never leak into inference, review, or persistence.
 */

export const MAX_REPOSITORIES = 25;
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Actions that request repository cloning rather than GitHub API forwarding. */
export const GIT_ACTIONS = MANAGED_GIT_ACTIONS;

export type GitAction = (typeof GIT_ACTIONS)[number];
export type GithubApiAction = (typeof GITHUB_API_CREDENTIAL_ACTIONS)[number];
export type CredentialAction = GitAction | GithubApiAction;

/**
 * The API actions a bare `--enable-managed-credentials` requests.
 *
 * Supplying any `--credentials-action` replaces this set rather than adding to
 * it, so an explicit narrow request is never silently widened.
 */
export const DEFAULT_API_ACTIONS: readonly GithubApiAction[] = [
  "github:issues:read",
  "github:issues:comment",
  "github:pull-request:create",
] as const;

const owner = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?";
const repositoryPattern = new RegExp(`^${owner}/[A-Za-z0-9._-]{1,100}$`);

export function isRepository(value: string): boolean {
  return (
    repositoryPattern.test(value) && ![".", ".."].includes(value.split("/")[1])
  );
}

/**
 * Map a short action name to its canonical GitHub action name.
 *
 * The product surface accepts `issues:read`; the API expects
 * `github:issues:read`. Git actions keep their own `git:` prefix.
 */
export function canonicalAction(value: string): CredentialAction | undefined {
  const trimmed = value.trim();
  if ((GIT_ACTIONS as readonly string[]).includes(trimmed)) {
    return trimmed as GitAction;
  }
  const prefixed = trimmed.startsWith("github:")
    ? trimmed
    : `github:${trimmed}`;
  return (GITHUB_API_CREDENTIAL_ACTIONS as readonly string[]).includes(prefixed)
    ? (prefixed as GithubApiAction)
    : undefined;
}

export function isGitAction(action: CredentialAction): action is GitAction {
  return (GIT_ACTIONS as readonly string[]).includes(action);
}

export function isApiAction(
  action: CredentialAction,
): action is GithubApiAction {
  return !isGitAction(action);
}

/**
 * Short names for the GitHub API actions `--credentials-action` accepts.
 *
 * Git access is not in this list: it is requested with
 * `--credentials-no-write` rather than as an action, so advertising
 * `git:write` here would suggest a second way to ask for it.
 */
export const ACCEPTED_API_ACTION_NAMES: readonly string[] =
  GITHUB_API_CREDENTIAL_ACTIONS.map((action) => action.replace(/^github:/, ""));

/** Every action name a configuration file may contain. */
export const ACCEPTED_ACTION_NAMES: readonly string[] = [
  ...GIT_ACTIONS,
  ...ACCEPTED_API_ACTION_NAMES,
];

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

/**
 * A GitHub actor, accepted as a username or an immutable numeric ID.
 *
 * Configuration files may carry the numeric form as a JSON number, as the
 * product specification's "Maximal" example does. Numbers are checked for
 * precision before being normalized to a string, so a value that lost
 * precision in JSON parsing is rejected rather than silently authorizing a
 * different account.
 */
const githubUserId = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .max(16)
  .refine((value) => Number.isSafeInteger(Number(value)), {
    message: "GitHub user ID exceeds safe integer precision",
  });

const githubUsername = z
  .string()
  .regex(/^@[A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?$/);

export const githubActor = z
  .union([z.string(), z.number()])
  .superRefine((value, ctx) => {
    if (typeof value !== "number") return;
    if (!Number.isInteger(value) || value <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "A numeric actAs must be a positive integer GitHub user ID.",
      });
      return;
    }
    if (!Number.isSafeInteger(value)) {
      // A JSON number this large already lost precision during parsing, so it
      // cannot be trusted to identify the intended account. Require the
      // string form instead of authorizing a neighbouring ID.
      ctx.addIssue({
        code: "custom",
        message:
          "A numeric actAs beyond 2^53-1 loses precision. Quote the ID as a string.",
      });
    }
  })
  .transform((value) => (typeof value === "number" ? String(value) : value))
  .transform((value) =>
    /^[0-9]+$/.test(value) || value.startsWith("@") ? value : `@${value}`,
  )
  .pipe(z.union([githubUserId, githubUsername]));

const action = z.string().transform((value, ctx) => {
  const canonical = canonicalAction(value);
  if (!canonical) {
    ctx.addIssue({ code: "custom", message: `Unsupported action: ${value}` });
    return z.NEVER;
  }
  return canonical;
});

const repository = z.string().refine(isRepository);

const githubGroup = z
  .object({
    repo: repository,
    actions: z.array(action).min(1).max(ACCEPTED_ACTION_NAMES.length),
    actAs: githubActor.optional(),
  })
  .strict()
  .refine((group) => unique(group.actions), {
    message: "Duplicate actions are not supported.",
  });

const sourceConfig = z
  .object({
    repo: repository,
    revision: z.string().min(1).max(256).optional(),
    depth: z.number().int().min(1).optional(),
  })
  .strict();

export const configSchema = z
  .object({
    source: sourceConfig.optional(),
    commitAs: z
      .object({
        name: z
          .string()
          .min(1)
          .max(256)
          .refine((value) => value.trim().length > 0),
        email: z.email().max(320),
      })
      .strict()
      .optional(),
    credentials: z
      .object({ github: z.array(githubGroup).max(MAX_REPOSITORIES) })
      .strict(),
  })
  .strict();

export type ManagedCredentialsConfig = z.infer<typeof configSchema>;
export type GithubCredentialGroup =
  ManagedCredentialsConfig["credentials"]["github"][number];

/**
 * Where a configuration came from.
 *
 * Explicit sources (a file or another Sandbox) state the access they want.
 * They never acquire the inferred defaults, so an empty `actions` list stays
 * empty and a `git:read` source is never upgraded to `git:write`.
 */
export type ConfigOrigin = "flags" | "file" | "sandbox";

export interface ResolvedConfig {
  config: ManagedCredentialsConfig;
  origin: ConfigOrigin;
  /** Human-readable description of the origin, for the review screen. */
  originLabel: string;
}

/**
 * Validate an untrusted value as a managed-credentials configuration.
 *
 * Accepts both the logical shape and the legacy transport shape that earlier
 * `--managed-credentials-file` inputs used, normalizing the legacy form so a
 * previously written file keeps working.
 */
export function parseConfig(value: unknown): ManagedCredentialsConfig {
  const normalized = normalizeLegacyShape(value);
  const parsed = configSchema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "$",
      message:
        issue.code === "unrecognized_keys"
          ? "Unknown fields are not supported."
          : // Zod echoes the offending value for some codes. A configuration
            // file should never contain a secret, but keep diagnostics to the
            // field path and a fixed explanation regardless.
            issue.message || "Invalid or missing value.",
    }));
    throw new CliError(
      `Invalid managed credentials configuration at ${issues[0].field}: ${issues[0].message}`,
      { data: { issues } },
    );
  }
  return validateConfig(parsed.data);
}

/**
 * Apply the cross-field rules the schema cannot express.
 *
 * Kept separate from parsing so configurations built in memory — from flags,
 * from inference, or copied from another Sandbox — go through exactly the same
 * checks as a configuration read from disk.
 */
export function validateConfig(
  config: ManagedCredentialsConfig,
): ManagedCredentialsConfig {
  const repositories = new Set<string>();
  if (config.source) repositories.add(config.source.repo.toLowerCase());

  const actors = new Map<string, string | undefined>();
  for (const group of config.credentials.github) {
    const key = group.repo.toLowerCase();
    repositories.add(key);
    if (actors.has(key)) {
      const existing = actors.get(key);
      // Usernames are resolved server-side, so two different spellings may
      // still name one account. Only compare values that are directly
      // comparable, and reject a genuine conflict rather than merging.
      const comparable =
        existing !== undefined &&
        group.actAs !== undefined &&
        !existing.startsWith("@") &&
        !group.actAs.startsWith("@");
      if (comparable && existing !== group.actAs) {
        throw new CliError(
          `Conflicting identities for ${group.repo}. Use one actAs per repository instead of relying on a merge.`,
          { data: { repository: group.repo } },
        );
      }
    } else {
      actors.set(key, group.actAs);
    }
  }

  if (repositories.size > MAX_REPOSITORIES) {
    throw new CliError(
      `Managed credentials support at most ${MAX_REPOSITORIES} distinct repositories, including the source.`,
    );
  }

  // `commitAs` without Git write is inert metadata, not an upgrade. The
  // product specification's "Maximal" example relies on this: it carries
  // commit metadata while the source holds only `git:read`.
  return config;
}

/** Git access the configuration requests for a repository, if any. */
export function gitAccessFor(
  config: ManagedCredentialsConfig,
  repo: string,
): GitAction | undefined {
  const actions = config.credentials.github
    .filter((group) => group.repo.toLowerCase() === repo.toLowerCase())
    .flatMap((group) => group.actions);
  if (actions.includes("git:write")) return "git:write";
  if (actions.includes("git:read")) return "git:read";
  return undefined;
}

/** True when `commitAs` is present but no repository grants Git write. */
export function hasInertCommitAs(config: ManagedCredentialsConfig): boolean {
  if (!config.commitAs) return false;
  return !config.credentials.github.some((group) =>
    group.actions.includes("git:write"),
  );
}

/**
 * Serialize a configuration for `--credentials-persist-configuration`.
 *
 * The output round-trips through {@link parseConfig}, so a persisted file can
 * be replayed with `--credentials-from-config-file`.
 */
export function serializeConfig(config: ManagedCredentialsConfig): string {
  const ordered: Record<string, unknown> = {};
  if (config.source) ordered.source = config.source;
  if (config.commitAs) ordered.commitAs = config.commitAs;
  ordered.credentials = {
    github: config.credentials.github.map((group) => ({
      repo: group.repo,
      actions: group.actions,
      ...(group.actAs !== undefined ? { actAs: group.actAs } : {}),
    })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Accept the legacy transport-shaped file format.
 *
 * Earlier `--managed-credentials-file` inputs used API field names: a `source`
 * with `type`/`url`, and groups with a `repositories` array whose actions were
 * GitHub API actions only, with Git write implied by `commitAs`. Normalizing
 * here keeps those files working without teaching the rest of the CLI two
 * shapes.
 */
function normalizeLegacyShape(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = { ...(value as Record<string, unknown>) };

  // Only a file that actually used the legacy transport shape gets the legacy
  // reading of `commitAs`. A logical-shape file states Git access as an
  // action, so inferring write access from commit metadata there would widen
  // the request the file asked for.
  let legacySource: string | undefined;
  if (input.source && typeof input.source === "object") {
    const source = input.source as Record<string, unknown>;
    if (typeof source.type === "string") {
      if (source.type !== "git" || typeof source.url !== "string") {
        throw new CliError(
          "Managed credentials require a GitHub Git source. Use source.repo with an OWNER/REPOSITORY value.",
        );
      }
      const repo = repositoryFromUrl(source.url);
      if (!repo) {
        throw new CliError(
          "Managed credentials require an HTTPS github.com source URL. Use source.repo with an OWNER/REPOSITORY value.",
        );
      }
      legacySource = repo;
      input.source = {
        repo,
        ...(source.revision !== undefined ? { revision: source.revision } : {}),
        ...(source.depth !== undefined ? { depth: source.depth } : {}),
      };
    }
  }

  if (input.credentials && typeof input.credentials === "object") {
    const credentials = input.credentials as Record<string, unknown>;
    if (Array.isArray(credentials.github)) {
      const groups = credentials.github.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [entry];
        const group = entry as Record<string, unknown>;
        if (!Array.isArray(group.repositories)) return [group];
        // One legacy group fans out to one logical group per repository: the
        // logical model keys access by repository so per-repository mappings
        // stay explicit through review and persistence.
        return group.repositories.map((repo) => ({
          repo,
          actions: group.actions,
          ...(group.actAs !== undefined ? { actAs: group.actAs } : {}),
        }));
      });
      input.credentials = { github: groups };
    }
  } else if (input.credentials === undefined) {
    input.credentials = { github: [] };
  }

  // In the legacy shape, Git write came from `commitAs` plus a Git source
  // rather than from an action. Preserve that meaning for those files only.
  if (
    legacySource !== undefined &&
    input.commitAs !== undefined &&
    typeof input.credentials === "object" &&
    input.credentials !== null
  ) {
    const credentials = input.credentials as { github?: unknown };
    if (Array.isArray(credentials.github)) {
      const key = legacySource.toLowerCase();
      const existing = credentials.github.find(
        (group) =>
          group &&
          typeof group === "object" &&
          typeof (group as { repo?: unknown }).repo === "string" &&
          (group as { repo: string }).repo.toLowerCase() === key,
      ) as { actions?: unknown } | undefined;
      const hasGitAction =
        Array.isArray(existing?.actions) &&
        existing.actions.some(
          (entry) =>
            typeof entry === "string" &&
            (GIT_ACTIONS as readonly string[]).includes(entry),
        );
      if (existing && Array.isArray(existing.actions) && !hasGitAction) {
        existing.actions = [...existing.actions, "git:write"];
      } else if (!existing) {
        credentials.github.push({ repo: legacySource, actions: ["git:write"] });
      }
    }
  }

  return input;
}

/** Extract `OWNER/REPOSITORY` from an HTTPS github.com URL. */
export function repositoryFromUrl(value: string): string | undefined {
  const match =
    /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?$/i.exec(value);
  if (!match) return undefined;
  const repo = `${match[1]}/${match[2]}`;
  return isRepository(repo) ? repo : undefined;
}

/** Build the canonical HTTPS clone URL for a repository. */
export function repositoryUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}
