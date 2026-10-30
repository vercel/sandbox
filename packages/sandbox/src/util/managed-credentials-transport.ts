import type { ManagedSourceCredentials } from "@vercel/sandbox";
import { CliError } from "./cli-error";
import {
  type GithubApiAction,
  type ManagedCredentialsConfig,
  gitAccessFor,
  isApiAction,
  repositoryUrl,
} from "./managed-credentials-config";

/**
 * The Sandbox creation fields a logical configuration maps onto.
 *
 * The transport differs from the logical model in three ways, and this module
 * is the only place that knows about them:
 *
 * - Git access rides on the source (`source.credentials`), not in a credential
 *   group's `actions`.
 * - Credential groups carry a `repositories` array rather than one repository.
 * - Only GitHub API actions belong in `actions`.
 */
export interface ManagedCredentialsTransport {
  source?: {
    type: "git";
    url: string;
    revision?: string;
    depth?: number;
    credentials?: ManagedSourceCredentials;
  };
  commitAs?: { name: string; email: string };
  credentials?: {
    github: {
      repositories: string[];
      actions: GithubApiAction[];
      actAs?: string;
    }[];
  };
}

/**
 * Adapt a validated logical configuration to Sandbox creation fields.
 *
 * Git write is only ever requested when the configuration asks for it. A
 * `git:read` source is sent as `credentials: "read"`, and `commitAs` is
 * withheld in that case: commit metadata is inert without Git write, and
 * forwarding it would let the server's source handling infer write access the
 * configuration never requested.
 */
export function toTransport(
  config: ManagedCredentialsConfig,
): ManagedCredentialsTransport {
  const sourceRepo = config.source?.repo;

  // Git access is realized through the source, so it cannot be granted for a
  // repository the Sandbox does not clone. Fail loudly rather than dropping
  // the request and reporting success for access that was never granted.
  for (const group of config.credentials.github) {
    const gitActions = group.actions.filter((entry) => !isApiAction(entry));
    if (gitActions.length === 0) continue;
    if (
      sourceRepo === undefined ||
      group.repo.toLowerCase() !== sourceRepo.toLowerCase()
    ) {
      throw new CliError(
        `Git access (${gitActions.join(", ")}) is only available for the Sandbox source. Set source.repo to ${group.repo}, or request GitHub API actions for it instead.`,
        { data: { repository: group.repo, actions: gitActions } },
      );
    }
  }

  const transport: ManagedCredentialsTransport = {};

  if (config.source) {
    const access = gitAccessFor(config, config.source.repo);
    transport.source = {
      type: "git",
      url: repositoryUrl(config.source.repo),
      ...(config.source.revision !== undefined
        ? { revision: config.source.revision }
        : {}),
      ...(config.source.depth !== undefined
        ? { depth: config.source.depth }
        : {}),
      ...(access === "git:write"
        ? { credentials: true as const }
        : access === "git:read"
          ? { credentials: "read" as const }
          : {}),
    };
  }

  // Only a configuration that actually grants Git write can use commit
  // metadata. Keeping it out of the request otherwise is what stops the
  // "Maximal" example's inert `commitAs` from upgrading a read-only source.
  const grantsWrite = config.credentials.github.some((group) =>
    group.actions.includes("git:write"),
  );
  if (config.commitAs && grantsWrite) {
    transport.commitAs = config.commitAs;
  }

  transport.credentials = { github: toApiGroups(config) };
  return transport;
}

/**
 * Collapse logical per-repository entries into transport groups.
 *
 * Repositories that share an identical action set and identity travel as one
 * group, which keeps the request small. Entries that differ stay separate, so
 * per-repository mappings survive the round trip instead of being merged into
 * a union of permissions.
 */
function toApiGroups(config: ManagedCredentialsConfig) {
  const groups: {
    repositories: string[];
    actions: GithubApiAction[];
    actAs?: string;
  }[] = [];
  const index = new Map<string, number>();

  for (const group of config.credentials.github) {
    const actions = group.actions.filter(isApiAction);
    if (actions.length === 0) continue;
    const key = JSON.stringify([group.actAs ?? null, actions]);
    const existing = index.get(key);
    if (existing !== undefined) {
      groups[existing].repositories.push(group.repo);
      continue;
    }
    index.set(key, groups.length);
    groups.push({
      repositories: [group.repo],
      actions,
      ...(group.actAs !== undefined ? { actAs: group.actAs } : {}),
    });
  }

  return groups;
}
