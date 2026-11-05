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

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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

  const fetch = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const { signal } = controller;
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  let onAbort!: () => void;
  const expired = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
  });

  function checkDeadline(): void {
    if (Date.now() >= deadline) controller.abort();
    signal.throwIfAborted();
  }

  async function readJson(url: URL): Promise<unknown> {
    checkDeadline();
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      redirect: "error",
      signal,
    });
    checkDeadline();
    if (response.status !== 200 || response.redirected) return undefined;
    const body: unknown = await response.json();
    checkDeadline();
    return body;
  }

  async function readTeamSlug(id: string): Promise<string | undefined> {
    const metadata = record(
      await readJson(
        new URL(`https://vercel.com/api/v2/teams/${encodeURIComponent(id)}`),
      ),
    );
    return metadata?.id === id ? displayName(metadata.slug) : undefined;
  }

  async function readProjectName(): Promise<string | undefined> {
    const teamIsId = isScopeId(team, "team");
    if (!teamIsId && !displayName(team)) return undefined;
    const url = new URL(
      `https://vercel.com/api/v9/projects/${encodeURIComponent(project)}`,
    );
    url.searchParams.set(teamIsId ? "teamId" : "slug", team);
    const metadata = record(await readJson(url));
    if (!metadata || metadata.id !== project) return undefined;
    const name = displayName(metadata.name);
    if (!name) return undefined;
    if (teamIsId) return metadata.accountId === team ? name : undefined;

    // Slug lookup can fall through to a default team. Only the exact owning
    // team's ID AND slug can establish that this is the selected team's project.
    const accountId = metadata.accountId;
    if (!isSafeText(accountId) || !/^team_[a-zA-Z0-9]+$/.test(accountId)) {
      return undefined;
    }
    return (await readTeamSlug(accountId)) === team ? name : undefined;
  }

  // Racing each independent lookup preserves partial names and also bounds
  // injected fetch/JSON implementations that ignore the shared abort signal.
  const bounded = (lookup: Promise<string | undefined>) =>
    Promise.race([lookup, expired]).catch(() => undefined);
  try {
    const [resolvedTeam, resolvedProject] = await Promise.all([
      lookupTeam ? bounded(readTeamSlug(team)) : teamName,
      lookupProject ? bounded(readProjectName()) : projectName,
    ]);
    return {
      team: resolvedTeam ?? fallbackTeam,
      project: resolvedProject ?? fallbackProject,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
