import { fail } from "./fail";
import { printable } from "./printable";

const API_URL = "https://api.vercel.com";
const LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Whether the project has any Bounds, the project-wide limits on the GitHub
 * access its sandboxes can request. A lookup that fails is an error, never a
 * project without Bounds, and the error leaves out the response.
 */
export async function hasProjectBounds(options: {
  token: string;
  team: string;
  project: string;
  fetch?: typeof globalThis.fetch;
}): Promise<boolean> {
  const { token, team, project, fetch = globalThis.fetch } = options;
  const url = new URL(
    `/v1/git-credential-broker/projects/${encodeURIComponent(project)}/bounds`,
    API_URL,
  );
  url.searchParams.set("team", team);

  let bounds: unknown;
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (response.ok) {
      bounds = ((await response.json()) as { bounds?: unknown } | null)?.bounds;
    }
  } catch {
    bounds = undefined;
  }

  if (!Array.isArray(bounds)) {
    fail(
      `Cannot read the Bounds of project ${printable(project)} in team ${printable(team)}.`,
      "Check that your login or token can read that project. A project whose Bounds cannot be read is not treated as having none.",
    );
  }
  return bounds.length > 0;
}
