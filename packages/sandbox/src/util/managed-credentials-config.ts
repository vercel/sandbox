import {
  GITHUB_API_CREDENTIAL_ACTIONS,
  MANAGED_GIT_ACTIONS,
  SANDBOX_GITHUB_CREDENTIAL_ACTIONS,
} from "@vercel/sandbox";
import { z } from "zod";
import { CliError } from "./cli-error";

/**
 * The API-compatible managed-credentials subset of Sandbox creation fields.
 *
 * Files, persistence and transport use this same shape. Flag aliases are
 * normalized before constructing it, never while parsing a configuration file.
 * Other creation fields, such as project and resources, come from CLI context.
 */

export const MAX_REPOSITORIES = 25;
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Git-operation actions, including legacy read intent for flag diagnostics. */
export const GIT_ACTIONS = MANAGED_GIT_ACTIONS;

export type GitAction = (typeof GIT_ACTIONS)[number];
export type GithubApiAction = (typeof GITHUB_API_CREDENTIAL_ACTIONS)[number];
export type CredentialAction =
  (typeof SANDBOX_GITHUB_CREDENTIAL_ACTIONS)[number];

/**
 * The API actions a bare `--enable-github-credentials` requests.
 *
 * Supplying any `--credentials-github-action` replaces this set rather than adding to
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
export function canonicalAction(
  value: string,
): GitAction | GithubApiAction | undefined {
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

export function isGitAction(
  action: CredentialAction | GitAction,
): action is GitAction {
  return (GIT_ACTIONS as readonly string[]).includes(action);
}

export function isApiAction(
  action: CredentialAction,
): action is GithubApiAction {
  return !isGitAction(action);
}

/** Short API aliases remain accepted alongside canonical action names. */
export const ACCEPTED_API_ACTION_NAMES: readonly string[] =
  GITHUB_API_CREDENTIAL_ACTIONS.map((action) => action.replace(/^github:/, ""));

/** All actions supported by the Sandbox creation API, without provider splitting. */
export const ACCEPTED_CREATE_ACTION_NAMES: readonly string[] =
  SANDBOX_GITHUB_CREDENTIAL_ACTIONS.map((action) =>
    action.replace(/^github:/, ""),
  );

export function canonicalCreationAction(
  value: string,
): CredentialAction | undefined {
  const action = canonicalAction(value);
  return action &&
    (SANDBOX_GITHUB_CREDENTIAL_ACTIONS as readonly string[]).includes(action)
    ? (action as CredentialAction)
    : undefined;
}

/** Canonical action names accepted in configuration files, without aliases. */
export const ACCEPTED_ACTION_NAMES: readonly string[] =
  SANDBOX_GITHUB_CREDENTIAL_ACTIONS;

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

/** Canonical actors are @usernames or positive, safe-integer ID strings. */
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

const canonicalGithubActor = z.union([githubUserId, githubUsername]);

/** Flag-only actor normalizer; configuration files require canonical strings. */
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
  .pipe(canonicalGithubActor);

const action = z.enum(SANDBOX_GITHUB_CREDENTIAL_ACTIONS);
const repository = z.string().refine(isRepository);

const githubGroup = z
  .object({
    repositories: z.array(repository).min(1).max(MAX_REPOSITORIES),
    actions: z.array(action).min(1).max(ACCEPTED_ACTION_NAMES.length),
    actAs: canonicalGithubActor.optional(),
  })
  .strict()
  .refine((group) => unique(group.actions), {
    message: "Duplicate actions are not supported.",
  })
  .refine((group) => unique(group.repositories), {
    message: "Duplicate repositories are not supported.",
  });

const sourceConfig = z
  .object({
    type: z.literal("git"),
    url: z.string().refine((value) => repositoryFromUrl(value) !== undefined, {
      message:
        "Managed sources require a GitHub HTTPS repository URL without credentials, query parameters or fragments.",
    }),
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
 * They never acquire inferred defaults. Empty credential lists stay empty;
 * unsupported read actions are rejected rather than upgraded to write.
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
 * Accepts only the canonical API subset, with no CLI aliases or coercion.
 */
export function parseConfig(value: unknown): ManagedCredentialsConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "$",
      message:
        issue.code === "unrecognized_keys"
          ? "Unknown fields are not supported."
          : // Only custom messages are ours. Never echo untrusted URL, actor,
            // action or credential values from a library diagnostic.
            issue.code === "custom"
            ? issue.message
            : "Invalid or missing value.",
    }));
    throw new CliError(
      `Invalid managed credentials configuration at ${issues[0].field}: ${issues[0].message}`,
      { data: { issues } },
    );
  }
  // The schema has no transformations. Keep the original canonical object so
  // source-option and other object-key ordering also survive persistence.
  return validateConfig(value as ManagedCredentialsConfig);
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
  const sourceRepo = sourceRepository(config);
  if (sourceRepo) repositories.add(sourceRepo.toLowerCase());

  const actors = new Map<string, string>();
  for (const group of config.credentials.github) {
    for (const repo of group.repositories) {
      const key = repo.toLowerCase();
      repositories.add(key);
      // Usernames resolve server-side. Compare only immutable numeric actors,
      // remembering them even when another group has an unknown username.
      if (group.actAs !== undefined && !group.actAs.startsWith("@")) {
        const existing = actors.get(key);
        if (existing !== undefined && existing !== group.actAs) {
          throw new CliError(
            `Conflicting identities for ${repo}. Use one actAs per repository instead of relying on a merge.`,
            { data: { repository: repo } },
          );
        }
        actors.set(key, group.actAs);
      }
    }
  }

  if (repositories.size > MAX_REPOSITORIES) {
    throw new CliError(
      `Managed credentials support at most ${MAX_REPOSITORIES} distinct repositories, including the source.`,
    );
  }

  // Legacy commitAs makes the API infer git:write for the source and applies to
  // every writing repository. Never silently omit metadata or broaden access:
  // it is safe only when the exact same Git write was explicitly requested.
  if (config.commitAs) {
    const writingGroups = config.credentials.github.filter((group) =>
      group.actions.some(
        (action) => action === "git:write" || action === "git:write-workflows",
      ),
    );
    const writingRepositories = new Set(
      writingGroups.flatMap((group) =>
        group.repositories.map((repo) => repo.toLowerCase()),
      ),
    );
    if (
      sourceRepo === undefined ||
      writingRepositories.size !== 1 ||
      !writingRepositories.has(sourceRepo.toLowerCase()) ||
      !writingGroups.some((group) => group.actions.includes("git:write"))
    ) {
      throw new CliError(
        "commitAs requires exactly one writing repository matching source.url and explicitly requesting git:write. Omit commitAs to use per-repository managed identities.",
      );
    }
  }

  return config;
}

/** A disposable per-repository view; never use it as the persisted model. */
export function repositoryGroups(
  config: ManagedCredentialsConfig,
): Array<{ repo: string; actions: CredentialAction[]; actAs?: string }> {
  return config.credentials.github.flatMap((group) =>
    group.repositories.map((repo) => ({
      repo,
      actions: [...group.actions],
      ...(group.actAs !== undefined ? { actAs: group.actAs } : {}),
    })),
  );
}

/** Repository selected by the optional canonical clone source. */
export function sourceRepository(
  config: ManagedCredentialsConfig,
): string | undefined {
  return config.source ? repositoryFromUrl(config.source.url) : undefined;
}

/** Git access the configuration requests for a repository, if any. */
export function gitAccessFor(
  config: ManagedCredentialsConfig,
  repo: string,
): GitAction | undefined {
  const actions = config.credentials.github
    .filter((group) =>
      group.repositories.some(
        (entry) => entry.toLowerCase() === repo.toLowerCase(),
      ),
    )
    .flatMap((group) => group.actions);
  if (actions.includes("git:write-workflows")) return "git:write-workflows";
  if (actions.includes("git:write")) return "git:write";
  return undefined;
}

/**
 * Serialize a configuration for `--credentials-github-persist-configuration`.
 *
 * The output round-trips through {@link parseConfig}, so a persisted file can
 * be replayed with `--credentials-github-from-config-file`.
 */
export function serializeConfig(config: ManagedCredentialsConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
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
