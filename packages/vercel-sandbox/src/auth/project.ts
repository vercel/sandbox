import { z } from "zod";
import { fetchApi } from "./api.js";
import { NotOk } from "./error.js";
import { readLinkedProject } from "./linked-project.js";

const UserSchema = z.object({
  user: z.object({
    username: z.string(),
  }),
});

const DEFAULT_PROJECT_NAME = "vercel-sandbox-default-project";

/**
 * Resolves the team and project scope for sandbox operations.
 *
 * First checks for a locally linked project in `.vercel/project.json`.
 * If found, uses the `projectId` and `orgId` from there.
 *
 * Otherwise, if `teamId` is not provided, falls back to the authenticated user's
 * personal team (their username). Ensures a default project exists within the team,
 * creating it if necessary.
 *
 * @param opts.token - Vercel API authentication token.
 * @param opts.teamId - Optional team slug. If omitted, the user's personal team is used.
 * @param opts.cwd - Optional directory to search for `.vercel/project.json`. Defaults to `process.cwd()`.
 * @returns The resolved scope with `projectId`, `teamId`, and whether the project was `created`.
 *
 * @throws {NotOk} If the API returns an error other than 404 when checking the project.
 * @throws {ZodError} If the user API response is missing a username.
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
 * Falls back to the authenticated user's personal team by fetching
 * their username from the `/v2/user` endpoint.
 *
 * @param token - Authentication token used to call the Vercel API.
 * @returns A promise that resolves to the user's username (their personal team slug).
 */
export async function selectTeam(token: string) {
  const {
    user,
  } = await fetchApi({ token, endpoint: "/v2/user" }).then(
    UserSchema.parse,
  );
  return user.username;
}
