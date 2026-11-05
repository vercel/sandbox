import { z } from "zod";
import { CliError } from "./cli-error";
import {
  createVercelApi,
  projectId,
  selector,
  type VercelApiClient,
} from "./vercel-api";

const LOOKUP_TIMEOUT_MS = 10_000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;
const teamId = z.string().regex(/^team_[a-zA-Z0-9]+$/);
const pageSchema = z.object({
  // Only identity determines presence. Do not interpret repository/action rights
  // or display names: even a Bound with empty rights is still a project Bound.
  bounds: z
    .array(z.object({ id: selector, projectId, teamId }))
    .max(PAGE_LIMIT),
  pagination: z.object({ next: z.string().min(1).max(4096).nullable() }),
});

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
 * Both IDs and edited slugs are verified by a read-authorized project lookup.
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
        const project = await api.project(options.team, options.project);
        const cursors = new Set<string>();
        let cursor: string | undefined;
        // At most 100 Bounds pages, one project GET, and one team GET.
        for (let index = 0; index < MAX_PAGES; index++) {
          const page = pageSchema.parse(
            await api.get("/v1/git-credential-broker/bounds", {
              teamId: project.accountId,
              limit: String(PAGE_LIMIT),
              ...(cursor === undefined ? {} : { cursor }),
            }),
          );
          const next = page.pagination.next;
          // Validate the whole page before accepting any match.
          if (
            page.bounds.some((bound) => bound.teamId !== project.accountId) ||
            (next !== null && cursors.has(next))
          )
            throw lookupFailure();
          if (page.bounds.some((bound) => bound.projectId === project.id))
            return true;
          if (next === null) return false;
          cursors.add(next);
          cursor = next;
        }
        throw lookupFailure();
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
    "Could not read the project's managed-credential Bounds. Check the selected team and project. Make sure that the token has read access to the project and its team's policy. Then retry. An unreadable policy is not treated as having no Bounds.",
    { reason: "policy_unknown" },
  );
}
