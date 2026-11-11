import { createVercelApi, type VercelApiClient } from "./vercel-api";

const LOOKUP_TIMEOUT_MS = 3_000;
const TEAM_UNAVAILABLE = "team name unavailable";
const PROJECT_UNAVAILABLE = "project name unavailable";

/** Identify opaque selectors that need a readable-name lookup. */
export function isScopeId(value: string, kind: "team" | "project"): boolean {
  return kind === "team"
    ? value.startsWith("team_")
    : value.startsWith("prj_") || /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value);
}

function isSafeText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    value.trim() === value &&
    // Includes terminal controls, bidi overrides/isolates, invisible format
    // characters, unpaired surrogates, and Unicode line separators.
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  );
}

function displayName(value: unknown): string | undefined {
  return isSafeText(value) &&
    !isScopeId(value, "team") &&
    !isScopeId(value, "project")
    ? value
    : undefined;
}

/**
 * Best-effort labels only. Never use these results as API selectors or auth.
 * Hints do not change the exact scope or token used for any metadata GET.
 */
export async function resolveScopeDisplay(options: {
  token: string;
  team: string;
  project: string;
  teamSlug?: string;
  projectSlug?: string;
  fetch?: typeof globalThis.fetch;
  api?: VercelApiClient;
}): Promise<{ team: string; project: string }> {
  const { token, team, project, teamSlug, projectSlug } = options;
  const fallbackTeam = isSafeText(team) ? team : TEAM_UNAVAILABLE;
  const fallbackProject = isSafeText(project) ? project : PROJECT_UNAVAILABLE;
  const teamName = displayName(team) ?? displayName(teamSlug);
  const projectName = displayName(project) ?? displayName(projectSlug);
  const lookupTeam = !teamName && isScopeId(team, "team");
  const lookupProject = !projectName && isScopeId(project, "project");
  if (!lookupTeam && !lookupProject) {
    return {
      team: teamName ?? fallbackTeam,
      project: projectName ?? fallbackProject,
    };
  }

  const result = {
    team: teamName ?? fallbackTeam,
    project: projectName ?? fallbackProject,
  };
  const client =
    options.api ?? createVercelApi({ token, fetch: options.fetch });
  try {
    await client.run(LOOKUP_TIMEOUT_MS, async (api) => {
      await Promise.all([
        lookupTeam
          ? api
              .team(team)
              .then((metadata) => {
                result.team = displayName(metadata.slug) ?? fallbackTeam;
              })
              .catch(() => {})
          : undefined,
        lookupProject && (isScopeId(team, "team") || displayName(team))
          ? api
              .project(team, project)
              .then((metadata) => {
                if (metadata.id === project)
                  result.project =
                    displayName(metadata.name) ?? fallbackProject;
              })
              .catch(() => {})
          : undefined,
      ]);
    });
  } catch {
    // Names are optional. Preserve each completed lookup and the other IDs.
  }
  return result;
}
