import { CliError } from "./cli-error";
import {
  DEFAULT_API_ACTIONS,
  type CredentialAction,
  type ManagedCredentialsConfig,
  canonicalCreationAction,
  isRepository,
  parseConfig,
  repositoryUrl,
} from "./managed-credentials-config";
import type { InferredActor } from "./managed-credentials-identity";
import { inferActor } from "./managed-credentials-actor";
import { inferRepository } from "./managed-credentials-repository";
import { readJsonPayload } from "./managed-credentials-payload";

/**
 * Raw managed-credentials options as parsed from the command line.
 *
 * `persistConfiguration` uses `""` for the bare flag and a path when one was
 * supplied, matching the specified "explicit file path or a bare flag".
 */
export interface ManagedCredentialsOptions {
  enableManagedCredentials?: boolean;
  credentialsRepo?: string;
  credentialsActions: string[];
  credentialsActAs?: string;
  credentialsFromConfigFile?: string;
  credentialsFromSandbox?: string;
  credentialsPersistConfiguration?: string;
}

/** Direct flags that describe a single repository's access. */
const DIRECT_FLAGS = [
  ["credentialsRepo", "--credentials-github-repo"],
  ["credentialsActions", "--credentials-github-action"],
  ["credentialsActAs", "--credentials-github-act-as"],
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

export interface ResolvedManagedCredentials {
  config: ManagedCredentialsConfig;
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
  if (options.credentialsActions.length > 0)
    parseActions(options.credentialsActions);
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
  if (options.credentialsPersistConfiguration === "") {
    throw new CliError(
      "--credentials-github-persist-configuration requires a file path.",
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
    };
  }

  return resolveFromFlags(options, context);
}

async function resolveFromFlags(
  options: ManagedCredentialsOptions,
  context: ResolveContext,
): Promise<ResolvedManagedCredentials> {
  // --- Repository -----------------------------------------------------
  let repo = options.credentialsRepo;
  if (repo !== undefined) {
    if (!isRepository(repo)) {
      throw new CliError(
        `--credentials-github-repo expects OWNER/REPOSITORY. Received: ${repo}`,
      );
    }
  } else {
    repo = await (context.inferRepositoryImpl ?? inferRepository)(context.cwd);
    if (repo === undefined) {
      throw new CliError(
        "Can't infer the repository for managed credentials. Run the command inside a GitHub repository with a github.com remote, or pass --credentials-github-repo OWNER/REPOSITORY.",
        {
          reason: "missing_context",
        },
      );
    }
  }

  // Explicit actions replace the complete set, including Git access.
  const explicitActions = options.credentialsActions.length > 0;
  const actions: CredentialAction[] = explicitActions
    ? parseActions(options.credentialsActions)
    : [...DEFAULT_API_ACTIONS, "git:write"];

  // One selected actor applies to Git operations and GitHub API operations.
  const actor = await (context.inferActorImpl ?? inferActor)({
    ...(options.credentialsActAs !== undefined
      ? { explicit: options.credentialsActAs }
      : {}),
    token: context.token,
    ...(context.teamId ? { teamId: context.teamId } : {}),
    ...(context.fetch ? { fetch: context.fetch } : {}),
  });

  if (!actor && actions.length > 0) {
    throw new CliError(
      "Can't resolve the GitHub account to act as. Log in with gh, or pass --credentials-github-act-as with a GitHub username or numeric user ID.",
      {
        reason: "missing_context",
      },
    );
  }

  // Validated through the same schema a configuration file goes through, so an
  // inferred or flag-supplied value cannot reach the API in a shape a file
  // would have been rejected for — and so the persisted file always loads back.
  const config = parseConfig({
    source: { type: "git", url: repositoryUrl(repo) },
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
