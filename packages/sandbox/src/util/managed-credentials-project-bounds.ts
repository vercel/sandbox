import { z } from "zod";
import { CliError } from "./cli-error";

const LOOKUP_TIMEOUT_MS = 10_000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;
// Projects also retain legacy 46-character IPFS IDs, including in team-wide
// Bounds for projects other than the selected one.
const projectId = z
  .string()
  .regex(/^(?:prj_[a-zA-Z0-9]+|Qm[1-9A-HJ-NP-Za-km-z]{44})$/);
const teamId = z.string().regex(/^team_[a-zA-Z0-9]+$/);
const selector = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      value.trim() === value &&
      value !== "." &&
      value !== ".." &&
      !/[\u0000-\u001f\u007f]/.test(value),
  );
const projectSchema = z.object({
  id: projectId,
  accountId: teamId,
  name: selector,
});
const teamSchema = z.object({ id: teamId, slug: selector });
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
}

/**
 * Read whether the final selected project has any Bounds, not their coverage.
 * Both IDs and edited slugs are verified by a read-authorized project lookup.
 * This never infers scope, creates a project, or refreshes authentication.
 */
export async function hasProjectBounds(
  options: ProjectBoundsOptions,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(lookupFailure());
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    selector.parse(options.team);
    selector.parse(options.project);
    selector.parse(options.token);
    signal.throwIfAborted();
    // Bound the whole operation, including JSON reads and injected transports
    // that might not honor abort. Each read also checks abort before continuing.
    return await Promise.race([readProjectBounds(options, signal), aborted]);
  } catch {
    // Never surface untrusted response bodies, schema errors, or auth details.
    throw lookupFailure();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function readProjectBounds(
  options: ProjectBoundsOptions,
  signal: AbortSignal,
): Promise<boolean> {
  const fetch = options.fetch ?? globalThis.fetch;
  const projectUrl = new URL(
    `https://vercel.com/api/v9/projects/${encodeURIComponent(options.project)}`,
  );
  const requestedTeamId = options.team.startsWith("team_");
  projectUrl.searchParams.set(
    requestedTeamId ? "teamId" : "slug",
    options.team,
  );
  const project = projectSchema.parse(
    await readJson(projectUrl, options.token, fetch, signal),
  );
  // The server tries both ID and name, with length deciding which comes first.
  // A prj_ prefix (or an ID's length) does not rule out an exact project name.
  if (
    (project.id !== options.project && project.name !== options.project) ||
    (requestedTeamId && project.accountId !== options.team)
  ) {
    throw lookupFailure();
  }
  if (!requestedTeamId) {
    // Project auth can accept a username slug and silently select a default
    // team. Read the exact owning team, whose endpoint ignores default teams,
    // then verify its ID and slug before querying any Bounds.
    const teamUrl = new URL(
      `https://vercel.com/api/v2/teams/${encodeURIComponent(project.accountId)}`,
    );
    const team = teamSchema.parse(
      await readJson(teamUrl, options.token, fetch, signal),
    );
    if (team.id !== project.accountId || team.slug !== options.team) {
      throw lookupFailure();
    }
  }

  const cursors = new Set<string>();
  let cursor: string | undefined;
  // At most MAX_PAGES Bounds requests, one project GET, and one team GET (102).
  for (let index = 0; index < MAX_PAGES; index++) {
    const url = new URL(
      "https://vercel.com/api/v1/git-credential-broker/bounds",
    );
    url.searchParams.set("teamId", project.accountId);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    const page = pageSchema.parse(
      await readJson(url, options.token, fetch, signal),
    );
    const next = page.pagination.next;
    // Validate the entire page and its scope before accepting a matching entry.
    if (
      page.bounds.some((bound) => bound.teamId !== project.accountId) ||
      (next !== null && cursors.has(next))
    ) {
      throw lookupFailure();
    }
    if (page.bounds.some((bound) => bound.projectId === project.id))
      return true;
    if (next === null) return false;
    cursors.add(next);
    cursor = next;
  }
  throw lookupFailure();
}

async function readJson(
  url: URL,
  token: string,
  fetch: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    credentials: "omit",
    redirect: "error",
    signal,
  });
  signal.throwIfAborted();
  if (response.status !== 200 || response.redirected) throw lookupFailure();
  const body: unknown = await response.json();
  signal.throwIfAborted();
  return body;
}

function lookupFailure(): CliError {
  return new CliError(
    "Could not read the project's managed-credential Bounds. Check the selected team and project. Make sure that the token has read access to the project and its team's policy. Then retry. An unreadable policy is not treated as having no Bounds.",
    { reason: "policy_unknown" },
  );
}
