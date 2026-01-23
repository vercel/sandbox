import { z } from "zod";
import { fetchApi } from "./api";
import { NotOk } from "./error";
import { readLinkedProject } from "./linked-project";

const TeamsSchema = z.object({
  teams: z
    .array(
      z.object({
        slug: z.string(),
      }),
    )
    .min(1, `No teams found. Please create a team first.`),
});

const DEFAULT_PROJECT_NAME = "vercel-sandbox-default-project";

/**
 * Resolves the team and project scope for sandbox operations.
 *
 * First checks for a locally linked project in `.vercel/project.json`.
 * If found, uses the `projectId` and `orgId` from there.
 *
 * Otherwise, if `teamId` is not provided, selects the first available team for the account.
 * Ensures a default project exists within the team, creating it if necessary.
 *
 * @param opts.token - Vercel API authentication token.
 * @param opts.teamId - Optional team slug. If omitted, the first team is selected.
 * @param opts.cwd - Optional directory to search for `.vercel/project.json`. Defaults to `process.cwd()`.
 * @returns The resolved scope with `projectId`, `teamId`, and whether the project was `created`.
 *
 * @throws {NotOk} If the API returns an error other than 404 when checking the project.
 * @throws {ZodError} If no teams exist for the account.
 *
 * @example
 * ```ts
 * const scope = await inferScope({ token: "vercel_..." });
 * // => { projectId: "vercel-sandbox-default-project", teamId: "my-team", created: false }
 * ```
 */
export async function inferScope(opts: {
  token: string;
  teamId?: string;
  cwd?: string;
}): Promise<{ projectId: string; teamId: string; created: boolean }> {
  const linkedProject = await readLinkedProject(opts.cwd ?? process.cwd());
  if (linkedProject) {
    return { ...linkedProject, created: false };
  }

  const teamId = opts.teamId ?? (await selectTeam(opts.token));

  let created = false;
  try {
    await fetchApi({
      token: opts.token,
      endpoint: `/v2/projects/${encodeURIComponent(DEFAULT_PROJECT_NAME)}?slug=${encodeURIComponent(teamId)}`,
    });
  } catch (e) {
    if (!(e instanceof NotOk) || e.response.statusCode !== 404) {
      throw e;
    }

    await fetchApi({
      token: opts.token,
      endpoint: `/v11/projects?slug=${encodeURIComponent(teamId)}`,
      method: "POST",
      body: JSON.stringify({
        name: DEFAULT_PROJECT_NAME,
      }),
    });
    created = true;
  }

  return { projectId: DEFAULT_PROJECT_NAME, teamId, created };
}

/**
 * Selects a team for the current token by querying the Teams API and
 * returning the slug of the first team in the result set.
 *
 * @param token - Authentication token used to call the Vercel API.
 * @returns A promise that resolves to the first team's slug.
 */
export async function selectTeam(token: string) {
  const {
    teams: [team],
  } = await fetchApi({ token, endpoint: "/v2/teams?limit=1" }).then(
    TeamsSchema.parse,
  );
  return team.slug;
}
