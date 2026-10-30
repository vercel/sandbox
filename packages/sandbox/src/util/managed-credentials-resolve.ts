import { CliError } from "./cli-error";
import {
  DEFAULT_API_ACTIONS,
  type CredentialAction,
  type ConfigOrigin,
  type GithubApiAction,
  type ManagedCredentialsConfig,
  type ResolvedConfig,
  canonicalAction,
  isApiAction,
  isRepository,
  parseConfig,
  validateConfig,
} from "./managed-credentials-config";
import {
  type CommitIdentity,
  type IdentitySource,
  type InferredActor,
  commitIdentityFromProfile,
  inferActor,
  inferCommitIdentity,
  inferRepository,
  parseCommitAs,
} from "./managed-credentials-inference";
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
  credentialsCommitAs?: string;
  credentialsActAs?: string;
  credentialsNoWrite?: boolean;
  credentialsFromConfigFile?: string;
  credentialsFromSandbox?: string;
  credentialsPersistConfiguration?: string;
}

/** Direct flags that describe a single repository's access. */
const DIRECT_FLAGS = [
  ["credentialsRepo", "--credentials-repo"],
  ["credentialsActions", "--credentials-action"],
  ["credentialsCommitAs", "--credentials-commit-as"],
  ["credentialsActAs", "--credentials-act-as"],
  ["credentialsNoWrite", "--credentials-no-write"],
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
  repository?: "explicit" | "git-remote" | "config";
  commitAs?: IdentitySource | "profile-fallback" | "config" | "omitted";
  actor?: IdentitySource | "config" | "unresolved";
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
  /** Resolve `--credentials-from-sandbox` through a read-only lookup. */
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
function assertCompatibleOptions(options: ManagedCredentialsOptions): void {
  const direct = suppliedDirectFlags(options);

  // Persisting only says where to write a configuration. On its own it would
  // otherwise exit successfully having written nothing.
  if (
    options.credentialsPersistConfiguration !== undefined &&
    !hasManagedCredentialsRequest(options)
  ) {
    throw new CliError(
      "--credentials-persist-configuration saves a managed-credentials configuration, but none was requested. Add --enable-managed-credentials, or one of the other --credentials-* options.",
    );
  }

  if (
    options.credentialsFromConfigFile !== undefined &&
    options.credentialsFromSandbox !== undefined
  ) {
    throw new CliError(
      "--credentials-from-config-file and --credentials-from-sandbox both supply a complete configuration. Pass one.",
    );
  }

  const explicitSource =
    options.credentialsFromConfigFile !== undefined
      ? "--credentials-from-config-file"
      : options.credentialsFromSandbox !== undefined
        ? "--credentials-from-sandbox"
        : undefined;

  if (explicitSource && direct.length > 0) {
    throw new CliError(
      `${explicitSource} already states the requested access, so it cannot be combined with ${direct.join(", ")}. Edit the configuration instead of merging permission sets.`,
    );
  }

  if (explicitSource && options.enableManagedCredentials === true) {
    throw new CliError(
      `--enable-managed-credentials selects the inferred defaults, which would contradict ${explicitSource}. Drop the enable flag; the configuration already enables managed credentials.`,
    );
  }

  if (options.credentialsFromConfigFile === "") {
    throw new CliError(
      "--credentials-from-config-file requires a file path, or - to read stdin.",
    );
  }

  if (options.credentialsFromSandbox === "") {
    throw new CliError(
      "--credentials-from-sandbox requires a Sandbox name or sbx_* identifier.",
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
      "--credentials-from-config-file",
    );
    return {
      config: parseConfig(payload),
      origin: "file",
      originLabel:
        options.credentialsFromConfigFile === "-"
          ? "configuration file (stdin)"
          : `configuration file ${options.credentialsFromConfigFile}`,
      provenance: { repository: "config", commitAs: "config", actor: "config" },
    };
  }

  if (options.credentialsFromSandbox !== undefined) {
    if (!context.loadFromSandbox) {
      throw new CliError(
        "--credentials-from-sandbox is unavailable in this context.",
      );
    }
    const config = await context.loadFromSandbox(
      options.credentialsFromSandbox,
    );
    return {
      config: validateConfig(config),
      origin: "sandbox",
      originLabel: `Sandbox ${options.credentialsFromSandbox}`,
      provenance: { repository: "config", commitAs: "config", actor: "config" },
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
        `--credentials-repo expects OWNER/REPOSITORY. Received: ${repo}`,
      );
    }
    provenance.repository = "explicit";
  } else {
    repo = await (context.inferRepositoryImpl ?? inferRepository)(context.cwd);
    if (repo === undefined) {
      throw new CliError(
        "Can't infer the repository for managed credentials. Run the command inside a GitHub repository with a github.com remote, or pass --credentials-repo OWNER/REPOSITORY.",
        {
          reason: "missing_context",
          data: { required: ["--credentials-repo"] },
        },
      );
    }
    provenance.repository = "git-remote";
  }

  // --- API actions ----------------------------------------------------
  // Supplied actions replace the defaults outright. Appending the omitted
  // defaults would widen a deliberately narrow request.
  const apiActions =
    options.credentialsActions.length > 0
      ? parseActions(options.credentialsActions)
      : [...DEFAULT_API_ACTIONS];

  // --- Git access -----------------------------------------------------
  // Git permission is decided independently of the API action set, so
  // overriding actions never changes it. `--credentials-no-write` downgrades
  // write to read without touching API actions.
  const gitAction: CredentialAction = options.credentialsNoWrite
    ? "git:read"
    : "git:write";

  // --- GitHub API actor -------------------------------------------------
  // Resolved before the commit identity so its profile metadata is available
  // as the commit-identity fallback without a second lookup.
  const actor = await (context.inferActorImpl ?? inferActor)({
    ...(options.credentialsActAs !== undefined
      ? { explicit: options.credentialsActAs }
      : {}),
    token: context.token,
    ...(context.teamId ? { teamId: context.teamId } : {}),
    ...(context.fetch ? { fetch: context.fetch } : {}),
  });
  provenance.actor = actor?.source ?? "unresolved";

  if (!actor && apiActions.length > 0) {
    throw new CliError(
      "Can't resolve the GitHub account to act as. Log in with gh, or pass --credentials-act-as with a GitHub username or numeric user ID.",
      {
        reason: "missing_context",
        data: { required: ["--credentials-act-as"] },
      },
    );
  }

  // --- Commit identity -------------------------------------------------
  let commitAs: CommitIdentity | undefined;
  if (options.credentialsCommitAs !== undefined) {
    if (options.credentialsNoWrite) {
      throw new CliError(
        "--credentials-commit-as has no effect with --credentials-no-write, which requests read-only Git access. Drop one of the two.",
      );
    }
    commitAs = parseCommitAs(options.credentialsCommitAs);
    provenance.commitAs = "explicit";
  } else if (options.credentialsNoWrite) {
    // A read-only configuration omits the inferred commit identity entirely,
    // so review never implies commits the Sandbox cannot make.
    provenance.commitAs = "omitted";
  } else {
    commitAs = await (context.inferCommitIdentityImpl ?? inferCommitIdentity)(
      context.cwd,
    );
    if (commitAs) {
      provenance.commitAs = "git-config";
    } else if (actor?.profile) {
      // No local Git identity, so fall back to connected profile metadata the
      // way the server-side `resolveGitIdentity` does: profile name, then
      // login, and the GitHub noreply address when a numeric ID is known.
      commitAs = commitIdentityFromProfile({
        ...(actor.profile.name ? { githubName: actor.profile.name } : {}),
        ...(actor.profile.login ? { githubLogin: actor.profile.login } : {}),
        ...(actor.profile.id ? { githubId: actor.profile.id } : {}),
        ...(actor.profile.email ? { githubEmail: actor.profile.email } : {}),
      });
      if (commitAs) provenance.commitAs = "profile-fallback";
    }

    if (!commitAs) {
      // Nothing is fabricated when the metadata cannot be resolved.
      throw new CliError(
        'Can\'t infer a commit identity for managed Git write access. Set git config user.name and user.email, pass --credentials-commit-as "Name <email>", or request read-only access with --credentials-no-write.',
        {
          reason: "missing_context",
          data: { required: ["--credentials-commit-as"] },
        },
      );
    }
  }

  // Validated through the same schema a configuration file goes through, so an
  // inferred or flag-supplied value cannot reach the API in a shape a file
  // would have been rejected for — and so the persisted file always loads back.
  const config = parseConfig({
    source: { repo },
    ...(commitAs ? { commitAs } : {}),
    credentials: {
      github: [
        {
          repo,
          actions: [...apiActions, gitAction],
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

/** Validate and canonicalize `--credentials-action` values. */
export function parseActions(values: readonly string[]): GithubApiAction[] {
  const actions: GithubApiAction[] = [];
  for (const value of values) {
    if (value.includes(",")) {
      throw new CliError(
        `--credentials-action takes one action per flag. Repeat the flag instead of a comma-separated list. Received: ${value}`,
      );
    }
    const canonical = canonicalAction(value);
    if (!canonical) {
      throw new CliError(
        `Unsupported --credentials-action value: ${value}. Run the command with --help to list the accepted actions.`,
      );
    }
    if (!isApiAction(canonical)) {
      throw new CliError(
        `--credentials-action configures GitHub API access. Use --credentials-no-write to request read-only Git access instead of ${value}.`,
      );
    }
    if (actions.includes(canonical)) {
      throw new CliError(`Duplicate --credentials-action value: ${value}.`);
    }
    actions.push(canonical);
  }
  return actions;
}

/** Fields a review correction may change, in dependency order. */
export const EDITABLE_FIELDS = [
  "team",
  "project",
  "repository",
  "actions",
  "commitAs",
  "actAs",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Fields whose inference depends on another field.
 *
 * Editing a team, project, repository, identity, or action set invalidates the
 * dependent inferences and the permission check, so the proposal is recomputed
 * before approval rather than patched in place.
 */
export const FIELD_DEPENDENTS: Record<EditableField, readonly EditableField[]> =
  {
    team: ["project", "actAs"],
    project: [],
    repository: ["commitAs"],
    actions: [],
    commitAs: [],
    actAs: [],
  };

/** Every field invalidated by editing `field`, including transitive ones. */
export function invalidatedBy(field: EditableField): EditableField[] {
  const seen = new Set<EditableField>();
  const walk = (current: EditableField) => {
    for (const dependent of FIELD_DEPENDENTS[current]) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      walk(dependent);
    }
  };
  walk(field);
  return [...seen];
}

export type { ConfigOrigin };
