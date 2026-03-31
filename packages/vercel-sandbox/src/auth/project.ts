import { z } from "zod";
import { fetchApi } from "./api.js";
import { NotOk } from "./error.js";
import { readLinkedProject } from "./linked-project.js";

const UserSchema = z.object({
  user: z.object({
    defaultTeamId: z.string().nullable(),
    username: z.string(),
  }),
});

const TeamsSchema = z.object({
  teams: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      updatedAt: z.number(),
      membership: z.object({
        role: z.string(),
      }),
    }),
  ),
});

const DEFAULT_PROJECT_NAME = "vercel-sandbox-default-project";

/**
 * Resolves the team and project scope for sandbox operations.
 *
 * First checks for a locally linked project in `.vercel/project.json`.
 * If found, uses the `projectId` and `orgId` from there.
 *
 * Otherwise, if `teamId` is not provided, builds an ordered list of candidate
 * teams to try: the user's `defaultTeamId` first (if set), then teams where
 * the user has an OWNER role (sorted by `updatedAt` desc, with the personal
 * team matching the username first). Tries each candidate until one succeeds.
 *
 * @param opts.token - Vercel API authentication token.
 * @param opts.teamId - Optional team slug. If omitted, candidate teams are resolved automatically.
 * @param opts.cwd - Optional directory to search for `.vercel/project.json`. Defaults to `process.cwd()`.
 * @returns The resolved scope with `projectId`, `teamId`, and whether the project was `created`.
 *
 * @throws {NotOk} If the API returns an error other than 404 when checking the project.
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

  if (opts.teamId) {
    return tryTeam(opts.token, opts.teamId);
  }

  const { candidateTeamIds, username } = await selectTeams(opts.token);

  for (const teamId of candidateTeamIds) {
    try {
      return await tryTeam(opts.token, teamId);
    } catch (e) {
      if (e instanceof NotOk && e.response.statusCode === 403) {
        continue;
      }
      throw e;
    }
  }

  throw new NotOk({
    statusCode: 403,
    responseText: `Authenticated as "${username}" but none of the available teams allow sandbox creation. Specify a team explicitly with --scope <team-id-or-slug>.`,
  });
}

/**
 * Attempts to use a specific team for sandbox operations by checking for
 * (or creating) the default project within that team.
 *
 * @returns The resolved scope if the team is usable.
 * @throws {NotOk} On authorization or other API errors.
 */
async function tryTeam(
  token: string,
  teamId: string,
): Promise<{ projectId: string; teamId: string; created: boolean }> {
  let created = false;
  try {
    await fetchApi({
      token,
      endpoint: `/v2/projects/${encodeURIComponent(DEFAULT_PROJECT_NAME)}?slug=${encodeURIComponent(teamId)}`,
    });
  } catch (e) {
    if (!(e instanceof NotOk) || e.response.statusCode !== 404) {
      throw e;
    }

    await fetchApi({
      token,
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
 * Builds an ordered list of candidate team IDs to try for sandbox creation.
 *
 * Fetches the user profile and their teams in parallel. Returns the user's
 * `defaultTeamId` first (if set), followed by the best OWNER team: the one
 * whose slug matches the username, or the most recently updated.
 *
 * @param token - Authentication token used to call the Vercel API.
 * @returns The ordered candidate team IDs and the username.
 */
export async function selectTeams(
  token: string,
): Promise<{ candidateTeamIds: string[]; username: string }> {
  const [userData, teamsData] = await Promise.all([
    fetchApi({ token, endpoint: "/v2/user" }).then(UserSchema.parse),
    fetchApi({ token, endpoint: "/v2/teams?limit=100" }).then(
      TeamsSchema.parse,
    ),
  ]);

  const { defaultTeamId, username } = userData.user;

  const ownerTeams = teamsData.teams.filter(
    (t) => t.membership.role === "OWNER",
  );

  // Pick the personal team (slug matches username), or the most recently updated
  const bestOwnerTeam =
    ownerTeams.find((t) => t.slug === username) ??
    ownerTeams.sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const candidateTeamIds: string[] = [];

  if (defaultTeamId) {
    candidateTeamIds.push(defaultTeamId);
  }

  if (bestOwnerTeam && !candidateTeamIds.includes(bestOwnerTeam.id)) {
    candidateTeamIds.push(bestOwnerTeam.id);
  }

  // If no teams found at all, try the username as personal team
  if (candidateTeamIds.length === 0) {
    candidateTeamIds.push(username);
  }

  return { candidateTeamIds, username };
}
