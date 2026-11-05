import { CliError } from "./cli-error";
import {
  type ManagedCredentialsConfig,
  parseConfig,
  sourceRepository,
} from "./managed-credentials-config";

/** The canonical configuration already uses the Sandbox creation API shape. */
export type ManagedCredentialsTransport = ManagedCredentialsConfig;

/** Validate without regrouping, translating fields or inferring permissions. */
export function toTransport(
  config: ManagedCredentialsConfig,
): ManagedCredentialsTransport {
  // Defend this request boundary even if an in-memory caller bypassed parsing.
  parseConfig(config);

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
    const sourceRepo = sourceRepository(config)?.toLowerCase();
    if (
      sourceRepo === undefined ||
      writingRepositories.size !== 1 ||
      !writingRepositories.has(sourceRepo) ||
      !writingGroups.some((group) => group.actions.includes("git:write"))
    ) {
      throw new CliError(
        "commitAs requires exactly one writing repository matching source.url and explicitly requesting git:write. Omit commitAs to use per-repository managed identities.",
      );
    }
  }

  return config;
}
