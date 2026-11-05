import { CliError } from "./cli-error";
import {
  DEFAULT_API_ACTIONS,
  type CredentialAction,
  type ConfigOrigin,
  type ManagedCredentialsConfig,
  type ResolvedConfig,
  canonicalCreationAction,
  isRepository,
  parseConfig,
  repositoryUrl,
} from "./managed-credentials-config";
import {
  type CommitIdentity,
  type IdentitySource,
  type InferredActor,
} from "./managed-credentials-identity";
import {
  type inferCommitIdentity,
  parseCommitAs,
} from "./managed-credentials-commit";
import { inferActor } from "./managed-credentials-actor";
import { inferRepository } from "./managed-credentials-repository";
import { readJsonPayload } from "./managed-credentials-payload";
import {
  GITHUB_ACCESS_LEVELS,
  GITHUB_ACCESS_PRESETS,
  type GithubAccess,
} from "./managed-credentials-github-access";

/**
 * Raw managed-credentials options as parsed from the command line.
 *
 * `persistConfiguration` uses `""` for the bare flag and a path when one was
 * supplied, matching the specified "explicit file path or a bare flag".
 */
export interface ManagedCredentialsOptions {
  githubAccess?: GithubAccess;
  enableManagedCredentials?: boolean;
  credentialsRepo?: string;
  credentialsActions: string[];
  credentialsCommitAs?: string;
  credentialsActAs?: string;
  credentialsNoWrite?: boolean;
  credentialsFromConfigFile?: string;
  credentialsFromSandbox?: string;
  credentialsPersistConfiguration?: string;
}

/** Direct flags that describe a single repository's access. */
const DIRECT_FLAGS = [
  ["githubAccess", "--github-access"],
  ["credentialsRepo", "--credentials-github-repo"],
  ["credentialsActions", "--credentials-github-action"],
  ["credentialsCommitAs", "--credentials-github-commit-as"],
  ["credentialsActAs", "--credentials-github-act-as"],
  ["credentialsNoWrite", "--credentials-github-no-write"],
] as const;

function suppliedDirectFlags(options: ManagedCredentialsOptions): string[] {
  return DIRECT_FLAGS.filter(([key]) =>
    key === "credentialsActions"
      ? options.credentialsActions.length > 0
      : options[key] !== undefined,
  ).map(([, flag]) => flag);
}

/**
 * Whether this invocation asks for managed credentials at all.
 *
 * A bare `create` must keep its existing behavior, and running inside a Git
 * repository is never on its own a request for repository access. Only an
 * explicit flag turns the feature on.
 */
export function hasManagedCredentialsRequest(
  options: ManagedCredentialsOptions,
): boolean {
  return (
    options.enableManagedCredentials === true ||
    options.credentialsFromConfigFile !== undefined ||
    options.credentialsFromSandbox !== undefined ||
    suppliedDirectFlags(options).length > 0
  );
}

/** How each field of the proposal was arrived at, for the review screen. */
export interface ConfigProvenance {
  team?: string;
  project?: string;
  repository?: "explicit" | "git-remote" | "config";
  commitAs?:
    | IdentitySource
    | "profile-fallback"
    | "config"
    | "omitted"
    | "actor-derived";
  actor?: IdentitySource | "config" | "unresolved";
  actions?: "default" | "explicit" | "github-access" | "config";
  gitAccess?: "github-access" | "default" | "explicit" | "config";
}

export interface ResolvedManagedCredentials extends ResolvedConfig {
  provenance: ConfigProvenance;
  /** The actor inference result, kept for review and re-computation. */
  actor?: InferredActor;
}

export interface ResolveContext {
  token: string;
  teamId?: string;
  cwd?: string;
  fetch?: typeof globalThis.fetch;
  /** Resolve `--credentials-github-from-sandbox` through a read-only lookup. */
  loadFromSandbox?: (selector: string) => Promise<ManagedCredentialsConfig>;
  inferRepositoryImpl?: typeof inferRepository;
  inferCommitIdentityImpl?: typeof inferCommitIdentity;
  inferActorImpl?: typeof inferActor;
}

/**
 * Reject input combinations rather than merging them.
 *
 * Explicit configurations and inferred single-repository flags describe access
 * in incompatible ways, so combining them would require implicitly merging
 * permission sets. The specification rules that out, so each combination is
 * named and refused with the alternative spelled out.
 */
export function assertCompatibleOptions(
  options: ManagedCredentialsOptions,
): void {
  if (options.githubAccess !== undefined) {
    if (
      !(GITHUB_ACCESS_LEVELS as readonly string[]).includes(
        options.githubAccess,
      )
    ) {
      throw new CliError("--github-access expects read or write.");
    }
    if (options.credentialsActions.length > 0) {
      throw new CliError(
        "--github-access cannot be combined with --credentials-github-action. Choose the preset or explicit actions.",
      );
    }
    if (options.credentialsNoWrite !== undefined) {
      throw new CliError(
        "--github-access already selects Git access. Do not combine it with --credentials-github-no-write.",
      );
    }
    if (
      options.githubAccess === "read" &&
      options.credentialsCommitAs !== undefined
    ) {
      throw new CliError(
        "--github-access=read requests read-only Git access. Remove --credentials-github-commit-as or request write access.",
      );
    }
  }
  if (options.credentialsActions.length > 0) {
    parseActions(options.credentialsActions);
    if (options.credentialsNoWrite !== undefined) {
      throw new CliError(
        "--credentials-github-action supplies the complete action set. Do not combine it with --credentials-github-no-write.",
      );
    }
  }
  const direct = suppliedDirectFlags(options);

  // Persisting only says where to write a configuration. On its own it would
  // otherwise exit successfully having written nothing.
  if (
    options.credentialsPersistConfiguration !== undefined &&
    !hasManagedCredentialsRequest(options)
  ) {
    throw new CliError(
      "--credentials-github-persist-configuration saves a managed-credentials configuration, but none was requested. Add --enable-github-credentials, or one of the other --credentials-github-* options.",
    );
  }

  if (
    options.credentialsFromConfigFile !== undefined &&
    options.credentialsFromSandbox !== undefined
  ) {
    throw new CliError(
      "--credentials-github-from-config-file and --credentials-github-from-sandbox both supply a complete configuration. Pass one.",
    );
  }

  const explicitSource =
    options.credentialsFromConfigFile !== undefined
      ? "--credentials-github-from-config-file"
      : options.credentialsFromSandbox !== undefined
        ? "--credentials-github-from-sandbox"
        : undefined;

  if (explicitSource && direct.length > 0) {
    throw new CliError(
      `${explicitSource} already states the requested access, so it cannot be combined with ${direct.join(", ")}. Edit the configuration instead of merging permission sets.`,
    );
  }

  if (explicitSource && options.enableManagedCredentials === true) {
    throw new CliError(
      `--enable-github-credentials selects the inferred defaults, which would contradict ${explicitSource}. Drop the enable flag; the configuration already enables managed credentials.`,
    );
  }

  if (options.credentialsFromConfigFile === "") {
    throw new CliError(
      "--credentials-github-from-config-file requires a file path, or - to read stdin.",
    );
  }

  if (options.credentialsFromSandbox === "") {
    throw new CliError(
      "--credentials-github-from-sandbox requires a Sandbox name or sbx_* identifier.",
    );
  }
  if (options.githubAccess === "read" || options.credentialsNoWrite === true) {
    throw new CliError(
      "--github-access=read and --credentials-github-no-write request managed git:read, which the current Sandbox creation API does not support. Choose supported actions explicitly; read access is never upgraded to write access.",
    );
  }
}

/**
 * Build the complete proposed configuration.
 *
 * Inference runs before any question is asked, so the user reviews one finished
 * proposal rather than approving each step. Explicit values always win over
 * inferred ones.
 */
export async function resolveManagedCredentials(
  options: ManagedCredentialsOptions,
  context: ResolveContext,
): Promise<ResolvedManagedCredentials | undefined> {
  assertCompatibleOptions(options);
  if (!hasManagedCredentialsRequest(options)) return undefined;

  if (options.credentialsFromConfigFile !== undefined) {
    const payload = await readJsonPayload(
      options.credentialsFromConfigFile,
      "--credentials-github-from-config-file",
    );
    return {
      config: parseConfig(payload),
      origin: "file",
      originLabel:
        options.credentialsFromConfigFile === "-"
          ? "configuration file (stdin)"
          : `configuration file ${options.credentialsFromConfigFile}`,
      provenance: {
        repository: "config",
        commitAs: "config",
        actor: "config",
        actions: "config",
        gitAccess: "config",
      },
    };
  }

  if (options.credentialsFromSandbox !== undefined) {
    if (!context.loadFromSandbox) {
      throw new CliError(
        "--credentials-github-from-sandbox is unavailable in this context.",
      );
    }
    const config = await context.loadFromSandbox(
      options.credentialsFromSandbox,
    );
    return {
      config: parseConfig(config),
      origin: "sandbox",
      originLabel: `Sandbox ${options.credentialsFromSandbox}`,
      provenance: {
        repository: "config",
        commitAs: "config",
        actor: "config",
        actions: "config",
        gitAccess: "config",
      },
    };
  }

  return resolveFromFlags(options, context);
}

async function resolveFromFlags(
  options: ManagedCredentialsOptions,
  context: ResolveContext,
): Promise<ResolvedManagedCredentials> {
  const provenance: ConfigProvenance = {};

  // --- Repository -----------------------------------------------------
  let repo = options.credentialsRepo;
  if (repo !== undefined) {
    if (!isRepository(repo)) {
      throw new CliError(
        `--credentials-github-repo expects OWNER/REPOSITORY. Received: ${repo}`,
      );
    }
    provenance.repository = "explicit";
  } else {
    repo = await (context.inferRepositoryImpl ?? inferRepository)(context.cwd);
    if (repo === undefined) {
      throw new CliError(
        "Can't infer the repository for managed credentials. Run the command inside a GitHub repository with a github.com remote, or pass --credentials-github-repo OWNER/REPOSITORY.",
        {
          reason: "missing_context",
          data: { required: ["--credentials-github-repo"] },
        },
      );
    }
    provenance.repository = "git-remote";
  }

  // Explicit actions replace the complete set, including Git access.
  const preset =
    options.githubAccess === "write" ? GITHUB_ACCESS_PRESETS.write : undefined;
  const explicitActions = options.credentialsActions.length > 0;
  const actions: CredentialAction[] = preset
    ? [...preset.apiActions, preset.gitAction]
    : explicitActions
      ? parseActions(options.credentialsActions)
      : [...DEFAULT_API_ACTIONS, "git:write"];
  provenance.actions = preset
    ? "github-access"
    : explicitActions
      ? "explicit"
      : "default";
  provenance.gitAccess =
    provenance.actions === "github-access"
      ? "github-access"
      : explicitActions
        ? "explicit"
        : "default";

  // One selected actor applies to Git operations and GitHub API operations.
  const actor = await (context.inferActorImpl ?? inferActor)({
    ...(options.credentialsActAs !== undefined
      ? { explicit: options.credentialsActAs }
      : {}),
    token: context.token,
    ...(context.teamId ? { teamId: context.teamId } : {}),
    ...(context.fetch ? { fetch: context.fetch } : {}),
  });
  provenance.actor = actor?.source ?? "unresolved";

  if (!actor && actions.length > 0) {
    throw new CliError(
      "Can't resolve the GitHub account to act as. Log in with gh, or pass --credentials-github-act-as with a GitHub username or numeric user ID.",
      {
        reason: "missing_context",
        data: { required: ["--credentials-github-act-as"] },
      },
    );
  }

  // Only explicit legacy metadata remains. The broker derives normal Git
  // attribution from actAs; local Git configuration does not select identity.
  let commitAs: CommitIdentity | undefined;
  if (options.credentialsCommitAs !== undefined) {
    commitAs = parseCommitAs(options.credentialsCommitAs);
    provenance.commitAs = "explicit";
  } else {
    provenance.commitAs = actions.some(
      (action) => action === "git:write" || action === "git:write-workflows",
    )
      ? "actor-derived"
      : "omitted";
  }

  // Validated through the same schema a configuration file goes through, so an
  // inferred or flag-supplied value cannot reach the API in a shape a file
  // would have been rejected for — and so the persisted file always loads back.
  const config = parseConfig({
    source: { type: "git", url: repositoryUrl(repo) },
    ...(commitAs ? { commitAs } : {}),
    credentials: {
      github: [
        {
          repositories: [repo],
          actions,
          ...(actor ? { actAs: actor.actAs } : {}),
        },
      ],
    },
  });

  return {
    config,
    origin: "flags",
    originLabel: "command-line flags",
    provenance,
    ...(actor ? { actor } : {}),
  };
}

/** Validate and canonicalize `--credentials-github-action` values. */
export function parseActions(values: readonly string[]): CredentialAction[] {
  const actions: CredentialAction[] = [];
  for (const value of values) {
    if (value.includes(",")) {
      throw new CliError(
        `--credentials-github-action takes one action per flag. Repeat the flag instead of a comma-separated list. Received: ${value}`,
      );
    }
    const canonical = canonicalCreationAction(value);
    if (!canonical) {
      throw new CliError(
        `Unsupported --credentials-github-action value: ${value}. Run the command with --help to list the accepted actions.`,
      );
    }
    if (actions.includes(canonical)) {
      throw new CliError(
        `Duplicate --credentials-github-action value: ${value}.`,
      );
    }
    actions.push(canonical);
  }
  return actions;
}

export type { ConfigOrigin };
