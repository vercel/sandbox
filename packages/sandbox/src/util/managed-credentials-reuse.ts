import { CliError } from "./cli-error";
import {
  type ManagedCredentialsConfig,
  canonicalCreationAction,
  repositoryFromUrl,
  parseConfig,
} from "./managed-credentials-config";

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
  fetchSnapshot: (
    selector: string,
  ) => Promise<SandboxCredentialSnapshot | undefined>;
}): Promise<ManagedCredentialsConfig> {
  let snapshot: SandboxCredentialSnapshot | undefined;
  try {
    snapshot = await options.fetchSnapshot(options.selector);
  } catch {
    throw new CliError(
      "Could not read the source Sandbox's managed-credential configuration. Check the Sandbox name, team, project, and credentials.",
      { reason: "configuration_lookup_failed", exitCode: 1 },
    );
  }

  if (!snapshot) {
    throw new CliError(
      `Sandbox ${options.selector} does not report a managed-credentials configuration, so there is nothing to reuse. The Sandbox API only returns one for Sandboxes created with managed credentials.`,
      {
        reason: "configuration_unavailable",
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
  const unsupported = () =>
    new CliError(
      `Sandbox ${selector} reports a credential request that this CLI cannot replay without changing it. Upgrade the CLI or supply a canonical API configuration.`,
      { reason: "configuration_unsupported" },
    );
  const groups = (snapshot.credentials?.github ?? []).map((group) => {
    if (
      group.actions.some((action) => canonicalCreationAction(action) !== action)
    )
      throw unsupported();
    let actAs = group.actAs;
    if (typeof actAs === "number") {
      if (!Number.isSafeInteger(actAs) || actAs <= 0) throw unsupported();
      actAs = String(actAs);
    }
    return {
      repositories: [...group.repositories],
      actions: [...group.actions],
      ...(actAs !== undefined ? { actAs } : {}),
    };
  });
  const writing = (action: string) =>
    action === "git:write" || action === "git:write-workflows";
  let derivedAttribution =
    !snapshot.source && groups.some((group) => group.actions.some(writing));
  let source:
    | { type: "git"; url: string; revision?: string; depth?: number }
    | undefined;
  if (snapshot.source) {
    const repo = repositoryFromUrl(snapshot.source.url);
    if (!repo || snapshot.source.credentials === "read") throw unsupported();
    source = {
      type: "git",
      url: snapshot.source.url,
      ...(snapshot.source.revision !== undefined
        ? { revision: snapshot.source.revision }
        : {}),
      ...(snapshot.source.depth !== undefined
        ? { depth: snapshot.source.depth }
        : {}),
    };
    const matchesSource = (group: (typeof groups)[number]) =>
      group.repositories.some(
        (value) => value.toLowerCase() === repo.toLowerCase(),
      );
    derivedAttribution = groups.some(
      (group) => matchesSource(group) && group.actions.some(writing),
    );
    if (snapshot.source.credentials === true && !derivedAttribution) {
      const index = groups.findIndex(matchesSource);
      if (index === -1)
        groups.push({ repositories: [repo], actions: ["git:write"] });
      else {
        const existing = groups[index];
        if (existing.repositories.length === 1)
          existing.actions.push("git:write");
        else {
          // Split only legacy source rights: never add write to unrelated
          // repositories that happened to share an API action group.
          const sourceEntry = existing.repositories.find(
            (value) => value.toLowerCase() === repo.toLowerCase(),
          )!;
          existing.repositories = existing.repositories.filter(
            (value) => value.toLowerCase() !== repo.toLowerCase(),
          );
          groups.splice(index + 1, 0, {
            repositories: [sourceEntry],
            actions: [...existing.actions, "git:write"],
            ...(existing.actAs !== undefined ? { actAs: existing.actAs } : {}),
          });
        }
      }
    }
  }
  return {
    ...(source ? { source } : {}),
    ...(snapshot.commitAs && !derivedAttribution
      ? { commitAs: { ...snapshot.commitAs } }
      : {}),
    credentials: { github: groups },
  };
}
