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

const TeamSchema = z.object({
  id: z.string(),
  slug: z.string(),
  updatedAt: z.number(),
  membership: z.object({
    role: z.string(),
  }),
  billing: z.object({
    plan: z.string(),
  }),
});

const TeamsSchema = z.object({
  teams: z.array(TeamSchema),
  pagination: z.object({
    count: z.number(),
    next: z.number().nullable(),
  }),
});

const DEFAULT_PROJECT_NAME = "vercel-sandbox-default-project";

/**
 * Resolves the team and project scope for sandbox operations.
 *
 * First checks for a locally linked project in `.vercel/project.json`.
 * If found, uses the `projectId` and `orgId` from there.
 *
 * Otherwise, if `teamId` is not provided, builds an ordered list of candidate
 * teams to try: the user's `defaultTeamId` first (if set), then hobby-plan
 * teams where the user has an OWNER role (preferring the personal team matching
 * the username, then the most recently updated). Tries each candidate until one
 * succeeds.
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
}): Promise<{
  projectId: string;
  teamId: string;
  created: boolean;
  teamSlug?: string;
  projectSlug?: string;
}> {
  const linkedProject = await readLinkedProject(opts.cwd ?? process.cwd());
  if (linkedProject) {
    const slugs = await resolveLinkedProjectSlugs(
      opts.token,
      linkedProject.teamId,
      linkedProject.projectId,
    );
    return { ...linkedProject, created: false, ...slugs };
  }

  if (opts.teamId) {
    return tryTeam(opts.token, opts.teamId);
  }

  const userData = await fetchApi({
    token: opts.token,
    endpoint: "/v2/user",
  }).then(UserSchema.parse);
  const { defaultTeamId, username } = userData.user;

  // 1. Try defaultTeamId first
  if (defaultTeamId) {
    try {
      const result = await tryTeam(opts.token, defaultTeamId);
      // Resolve team slug (best-effort)
      try {
        const team = await fetchApi({
          token: opts.token,
          endpoint: `/v2/teams/${encodeURIComponent(defaultTeamId)}`,
        }).then(z.object({ slug: z.string() }).parse);
        return { ...result, teamSlug: team.slug };
      } catch {
        return result;
      }
    } catch (e) {
      if (!(e instanceof NotOk) || e.response.statusCode !== 403) throw e;
    }
  }

  // 2. Paginate teams in pages of 20, try best hobby team per page
  let next: number | null = null;
  do {
    const endpoint: string =
      next === null
        ? "/v2/teams?limit=20"
        : `/v2/teams?limit=20&until=${next}`;
    const page = await fetchApi({ token: opts.token, endpoint }).then(
      TeamsSchema.parse,
    );

    next = page.pagination.next;

    const hobbyOwnerTeams = page.teams.filter(
      (t) => t.membership.role === "OWNER" && t.billing.plan === "hobby",
    );
    if (hobbyOwnerTeams.length === 0) {
      continue;
    }

    const bestHobbyTeam =
      hobbyOwnerTeams.find((t) => t.slug === username) ??
      hobbyOwnerTeams.sort((a, b) => b.updatedAt - a.updatedAt)[0];

    if (bestHobbyTeam && bestHobbyTeam.id !== defaultTeamId) {
      try {
        const result = await tryTeam(opts.token, bestHobbyTeam.id);
        return { ...result, teamSlug: bestHobbyTeam.slug };
      } catch (e) {
        if (!(e instanceof NotOk) || e.response.statusCode !== 403) throw e;
      }
    }
  } while (next !== null);

  // 3. Fall back to username as personal team
  try {
    const result = await tryTeam(opts.token, username);
    return { ...result, teamSlug: username };
  } catch (e) {
    if (!(e instanceof NotOk) || e.response.statusCode !== 403) throw e;
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
  const teamParam = teamId.startsWith("team_")
    ? `teamId=${encodeURIComponent(teamId)}`
    : `slug=${encodeURIComponent(teamId)}`;

  let created = false;
  try {
    await fetchApi({
      token,
      endpoint: `/v2/projects/${encodeURIComponent(DEFAULT_PROJECT_NAME)}?${teamParam}`,
    });
  } catch (e) {
    if (!(e instanceof NotOk) || e.response.statusCode !== 404) {
      throw e;
    }

    await fetchApi({
      token,
      endpoint: `/v11/projects?${teamParam}`,
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
 * Best-effort resolution of team slug and project name for a linked project.
 * Both IDs may be opaque (e.g. `team_xxx`, `prj_xxx`), so we fetch the
 * human-readable names from the API in parallel.
 */
async function resolveLinkedProjectSlugs(
  token: string,
  teamId: string,
  projectId: string,
): Promise<{ teamSlug?: string; projectSlug?: string }> {
  try {
    const teamParam = teamId.startsWith("team_")
      ? `teamId=${encodeURIComponent(teamId)}`
      : `slug=${encodeURIComponent(teamId)}`;
    const [teamData, projectData] = await Promise.all([
      fetchApi({
        token,
        endpoint: `/v2/teams/${encodeURIComponent(teamId)}`,
      }).then(z.object({ slug: z.string() }).parse),
      fetchApi({
        token,
        endpoint: `/v2/projects/${encodeURIComponent(projectId)}?${teamParam}`,
      }).then(z.object({ name: z.string() }).parse),
    ]);
    return { teamSlug: teamData.slug, projectSlug: projectData.name };
  } catch {
    return {};
  }
}
