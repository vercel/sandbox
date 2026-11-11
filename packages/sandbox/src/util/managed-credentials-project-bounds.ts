import { z } from "zod";
import { CliError } from "./cli-error";
import {
  createVercelApi,
  projectId,
  selector,
  type VercelApiClient,
} from "./vercel-api";

const LOOKUP_TIMEOUT_MS = 10_000;
const teamId = z.string().regex(/^team_[a-zA-Z0-9]+$/);
const responseSchema = z
  .object({
    teamId,
    projectId,
    // Presence depends on identity, not action coverage. Empty rights still count.
    bounds: z.array(z.object({ id: selector, teamId, projectId })),
  })
  .strict();

interface ProjectBoundsOptions {
  token: string;
  team: string;
  project: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  api?: VercelApiClient;
}

/**
 * Read whether the final selected project has any Bounds, not their coverage.
 * The project endpoint resolves selectors and authorizes the exact project.
 * This never infers scope, creates a project, or refreshes authentication.
 */
export async function hasProjectBounds(
  options: ProjectBoundsOptions,
): Promise<boolean> {
  const client = options.api ?? createVercelApi(options);
  try {
    return await client.run(
      LOOKUP_TIMEOUT_MS,
      async (api) => {
        const result = responseSchema.parse(
          await api.get(
            `/v1/git-credential-broker/projects/${encodeURIComponent(selector.parse(options.project))}/bounds`,
            { team: selector.parse(options.team) },
          ),
        );
        if (
          result.bounds.some(
            (bound) =>
              bound.teamId !== result.teamId ||
              bound.projectId !== result.projectId,
          )
        )
          throw lookupFailure();
        return result.bounds.length > 0;
      },
      options.signal,
    );
  } catch {
    // Never surface untrusted response bodies, schema errors, or auth details.
    throw lookupFailure();
  }
}

function lookupFailure(): CliError {
  return new CliError(
    "Could not read the project's managed-credential Bounds. Check the selected team and project. Make sure that the token has read access to the project. Then retry. An unreadable policy is not treated as having no Bounds.",
    { reason: "policy_unknown" },
  );
}
