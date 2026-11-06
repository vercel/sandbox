import { afterEach, expect, test, vi } from "vitest";
import { CliError } from "../../src/util/cli-error";
import { hasProjectBounds } from "../../src/util/managed-credentials-project-bounds";
import { createVercelApi } from "../../src/util/vercel-api";

const scope = {
  token: "private-token-never-print",
  team: "team_selected",
  project: "prj_selected",
};
const bound = { id: "bnd_one", teamId: scope.team, projectId: scope.project };
const response = (bounds: unknown[] = []) => ({
  teamId: scope.team,
  projectId: scope.project,
  bounds,
});
const fetchWith = (body: unknown) =>
  vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body));
const unknownPolicy = async (result: Promise<boolean>) => {
  const error = await result.catch((error) => error);
  expect(error).toBeInstanceOf(CliError);
  expect(error.options).toEqual({ reason: "policy_unknown" });
  expect(error.message).not.toContain(scope.token);
  expect(error.cause).toBeUndefined();
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test.each([[], [bound], [{ ...bound, actions: [] }]].map((bounds) => [bounds]))(
  "reads complete project Bounds in one authenticated request: %j",
  async (bounds) => {
    const fetch = fetchWith(response(bounds));
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(
      bounds.length > 0,
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL(
        "https://vercel.com/api/v1/git-credential-broker/projects/prj_selected/bounds?team=team_selected",
      ),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${scope.token}` },
        credentials: "omit",
        redirect: "error",
        signal: expect.any(AbortSignal),
      },
    );
  },
);

test.each([
  ["selected-team", "selected-project"],
  ["team_like_name", "prj_like_name"],
  [
    "edited-team&teamId=wrong#fragment",
    "edited/project?team=wrong&x=%#fragment",
  ],
])(
  "delegates exact selector resolution to the backend: %s / %s",
  async (team, project) => {
    const fetch = fetchWith(response());
    const input = Object.freeze({ token: scope.token, team, project, fetch });
    await expect(hasProjectBounds(input)).resolves.toBe(false);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.origin).toBe("https://vercel.com");
    expect(url.pathname).toBe(
      `/api/v1/git-credential-broker/projects/${encodeURIComponent(project)}/bounds`,
    );
    expect([...url.searchParams]).toEqual([["team", team]]);
    expect(url.hash).toBe("");
    expect(fetch).toHaveBeenCalledOnce();
    expect(input.team).toBe(team);
    expect(input.project).toBe(project);
  },
);

test("accepts a complete collection larger than the old page size", async () => {
  const fetch = fetchWith(response(Array.from({ length: 101 }, () => bound)));
  await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
});

test.each([
  null,
  {},
  { ...response(), teamId: "other-team" },
  { ...response(), projectId: "other-project" },
  { ...response(), bounds: undefined },
  { ...response(), bounds: null },
  response([{}]),
  response([{ ...bound, id: "" }]),
  response([{ ...bound, teamId: "team_other" }]),
  response([{ ...bound, projectId: "prj_other" }]),
  response([bound, { ...bound, projectId: "prj_other" }]),
  { ...response(), pagination: { next: "unfinished" } },
])("rejects malformed, mixed-scope or partial responses: %j", async (body) => {
  const fetch = fetchWith(body);
  await unknownPolicy(hasProjectBounds({ ...scope, fetch }));
  expect(fetch).toHaveBeenCalledOnce();
});

test.each(["", " ", ".", "..", "bad\u0000selector"])(
  "rejects invalid selectors before requesting anything: %j",
  async (value) => {
    for (const options of [
      { ...scope, team: value },
      { ...scope, project: value },
    ]) {
      const fetch = fetchWith(response());
      await unknownPolicy(hasProjectBounds({ ...options, fetch }));
      expect(fetch).not.toHaveBeenCalled();
    }
  },
);

test.each([
  async () => new Response(scope.token, { status: 403 }),
  async () => new Response(scope.token),
  async () => {
    throw new Error(scope.token);
  },
])("never treats an unreadable policy as empty or falls back", async (fail) => {
  const fetch = vi.fn<typeof globalThis.fetch>(fail);
  await unknownPolicy(hasProjectBounds({ ...scope, fetch }));
  expect(fetch).toHaveBeenCalledOnce();
});

test("keeps policy reads fresh even when sharing the invocation client", async () => {
  const fetch = fetchWith(response());
  const api = createVercelApi({ ...scope, fetch });
  await expect(hasProjectBounds({ ...scope, api })).resolves.toBe(false);
  await expect(hasProjectBounds({ ...scope, api })).resolves.toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("keeps the policy failure boundary for timeouts and caller cancellation", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
  const result = unknownPolicy(hasProjectBounds({ ...scope, fetch }));
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const controller = new AbortController();
  controller.abort();
  fetch.mockClear();
  await unknownPolicy(
    hasProjectBounds({ ...scope, fetch, signal: controller.signal }),
  );
  expect(fetch).not.toHaveBeenCalled();
});
