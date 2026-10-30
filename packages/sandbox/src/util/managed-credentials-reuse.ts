import { CliError } from "./cli-error";
import {
  type ManagedCredentialsConfig,
  canonicalAction,
  parseConfig,
} from "./managed-credentials-config";

const SANDBOX_ID = /^sbx_[A-Za-z0-9]+$/;

/**
 * The managed-credential request the API reports for an existing Sandbox.
 *
 * Only the *request* is readable. Tokens, Grant IDs, attestations, and the
 * approval the original creator gave are not part of this shape and are never
 * copied: reuse copies configuration, not authorization.
 */
export interface SandboxCredentialSnapshot {
  source?: {
    type: "git";
    url: string;
    revision?: string;
    depth?: number;
    credentials?: true | "read";
  };
  commitAs?: { name: string; email: string };
  credentials?: {
    github: {
      repositories: string[];
      actions: string[];
      actAs?: string | number;
    }[];
  };
}

/** Whether a selector is an `sbx_*` identifier or a Sandbox name. */
export function selectorKind(selector: string): "id" | "name" {
  return SANDBOX_ID.test(selector) ? "id" : "name";
}

/**
 * Look up a Sandbox's managed-credential configuration.
 *
 * The lookup is read-only: it never resumes the Sandbox or runs a command in
 * it just to inspect configuration. A stopped Sandbox is a perfectly good
 * source of configuration, and resuming one would both cost the user money and
 * change state they did not ask to change.
 */
export async function loadConfigFromSandbox(options: {
  selector: string;
  /** Read-only metadata fetch; must not resume the Sandbox. */
  fetchSnapshot: (params: {
    selector: string;
    kind: "id" | "name";
  }) => Promise<SandboxCredentialSnapshot | undefined>;
}): Promise<ManagedCredentialsConfig> {
  const kind = selectorKind(options.selector);
  const snapshot = await options.fetchSnapshot({
    selector: options.selector,
    kind,
  });

  if (!snapshot) {
    throw new CliError(
      `Sandbox ${options.selector} does not report a managed-credentials configuration, so there is nothing to reuse. The Sandbox API only returns one for Sandboxes created with managed credentials.`,
      {
        reason: "configuration_unavailable",
        data: { selector: options.selector },
      },
    );
  }

  return parseConfig(toConfig(snapshot, options.selector));
}

/**
 * Convert an API snapshot into the logical configuration model.
 *
 * The requested source, per-repository mappings, permissions, and explicit
 * identities are preserved exactly. Nothing is added: a copied configuration
 * carries the access it was created with, never the inferred defaults.
 */
export function toConfig(
  snapshot: SandboxCredentialSnapshot,
  selector: string,
): unknown {
  const groups: {
    repo: string;
    actions: string[];
    actAs?: string | number;
  }[] = [];

  for (const group of snapshot.credentials?.github ?? []) {
    for (const repo of group.repositories) {
      const actions = group.actions.filter((action) => {
        const canonical = canonicalAction(action);
        if (!canonical) {
          // A newer server action this CLI does not know would silently drop
          // out of the copy and understate the access being requested.
          throw new CliError(
            `Sandbox ${selector} requests the action "${action}", which this CLI version does not recognize. Upgrade the CLI before reusing its configuration.`,
            { reason: "configuration_unsupported" },
          );
        }
        return true;
      });
      groups.push({
        repo,
        actions,
        ...(group.actAs !== undefined ? { actAs: group.actAs } : {}),
      });
    }
  }

  // Git access travels on the source in the transport, so rebuild it as an
  // explicit action on the source repository's group.
  let sourceRepo: string | undefined;
  if (snapshot.source) {
    const match =
      /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?$/i.exec(
        snapshot.source.url,
      );
    if (!match) {
      throw new CliError(
        `Sandbox ${selector} has a source this CLI cannot express as a managed-credentials repository.`,
        { reason: "configuration_unsupported" },
      );
    }
    sourceRepo = `${match[1]}/${match[2]}`;
    const gitAction =
      snapshot.source.credentials === true
        ? "git:write"
        : snapshot.source.credentials === "read"
          ? "git:read"
          : undefined;
    if (gitAction) {
      const existing = groups.find(
        (group) => group.repo.toLowerCase() === sourceRepo?.toLowerCase(),
      );
      if (existing) existing.actions.push(gitAction);
      else groups.push({ repo: sourceRepo, actions: [gitAction] });
    }
  }

  return {
    ...(sourceRepo
      ? {
          source: {
            repo: sourceRepo,
            ...(snapshot.source?.revision !== undefined
              ? { revision: snapshot.source.revision }
              : {}),
            ...(snapshot.source?.depth !== undefined
              ? { depth: snapshot.source.depth }
              : {}),
          },
        }
      : {}),
    ...(snapshot.commitAs ? { commitAs: snapshot.commitAs } : {}),
    credentials: { github: groups },
  };
}
