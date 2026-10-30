import { CliError } from "./cli-error";
import {
  type CredentialAction,
  type ManagedCredentialsConfig,
} from "./managed-credentials-config";

/**
 * Bounds and Grants are different things, and conflating them would grant
 * project-wide access to satisfy one Sandbox:
 *
 * - A **Bound** is a project-wide ceiling: the access the project is permitted
 *   to request at all. Raising one changes policy for everybody in the project.
 * - A **Grant** gives one particular Sandbox access to one repository, within
 *   the ceiling the Bounds already allow.
 *
 * Creating a Sandbox asks for Grants. It only needs a Bound change when the
 * requested access sits outside the current ceiling, and that change needs its
 * own explicit approval because its blast radius is the whole project.
 */

/** One repository's project-wide ceiling. */
export interface Bound {
  repo: string;
  actions: CredentialAction[];
}

/** The project's current ceiling, or the fact that it could not be read. */
export type BoundsLookup =
  | { status: "known"; bounds: Bound[] }
  | { status: "unknown"; reason: string };

/** A minimal addition needed to bring the request inside the ceiling. */
export interface MissingBound {
  repo: string;
  /** Only the actions that are not already permitted. */
  actions: CredentialAction[];
}

/**
 * Compute the smallest set of Bound additions the request needs.
 *
 * Only the actions actually missing are returned, per repository, so approving
 * the addition never widens the project ceiling beyond what this request
 * requires.
 *
 * A lookup that failed is not treated as an empty policy: callers must refuse
 * to proceed rather than infer that everything is missing and ask to add it.
 */
export function calculateMissingBounds(
  config: ManagedCredentialsConfig,
  lookup: BoundsLookup,
): MissingBound[] {
  if (lookup.status === "unknown") {
    throw new CliError(
      `Can't read the project's managed-credential policy: ${lookup.reason}. The CLI does not treat an unreadable policy as empty, and will not propose policy additions from it.`,
      { reason: "policy_unknown" },
    );
  }

  const permitted = new Map<string, Set<string>>();
  for (const bound of lookup.bounds) {
    const key = bound.repo.toLowerCase();
    const existing = permitted.get(key) ?? new Set<string>();
    for (const action of bound.actions) existing.add(action);
    if (existing.has("git:write")) existing.add("git:read");
    permitted.set(key, existing);
  }

  const required = new Map<string, Set<CredentialAction>>();
  for (const group of config.credentials.github) {
    const key = group.repo.toLowerCase();
    const existing = required.get(key) ?? new Set<CredentialAction>();
    for (const action of group.actions) existing.add(action);
    required.set(key, existing);
  }

  const missing: MissingBound[] = [];
  for (const [key, actions] of required) {
    const allowed = permitted.get(key);
    const absent = [...actions].filter((action) => !allowed?.has(action));
    if (absent.length === 0) continue;
    // Report the repository with its original casing for display.
    const repo =
      config.credentials.github.find(
        (group) => group.repo.toLowerCase() === key,
      )?.repo ?? key;
    missing.push({ repo, actions: absent });
  }
  return missing;
}

/** Render proposed Bound additions for the review screen. */
export function describeMissingBounds(
  missing: readonly MissingBound[],
): string[] {
  return missing.map(
    (bound) => `${bound.repo}: ${bound.actions.join(", ")} (project-wide)`,
  );
}
