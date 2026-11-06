import { afterEach, expect, test, vi } from "vitest";
import { resolveScopeDisplay } from "../../src/util/scope-display";
import { hasProjectBounds } from "../../src/util/managed-credentials-project-bounds";
import { createVercelApi } from "../../src/util/vercel-api";

const scope = {
  token: "secret-canary",
  team: "team_selected",
  project: "prj_selected",
};
const project = { id: scope.project, accountId: scope.team, name: "web" };
const team = { id: scope.team, slug: "selected-team" };
const json = (body: unknown = {}) => Response.json(body);
const fetchWith = () =>
  vi.fn<typeof globalThis.fetch>().mockImplementation(async () => json());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Three distinct GETs prove that the deadline and request rules apply throughout
// an operation, rather than restarting for each request or each policy page.
function read(fetch: typeof globalThis.fetch, signal?: AbortSignal) {
  return createVercelApi({ ...scope, fetch }).run(
    10_000,
    async (api) => {
      for (const path of ["/first", "/second", "/third"]) await api.get(path);
    },
    signal,
  );
}

test("reads display metadata while project Bounds reads stay fresh", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const { pathname } = new URL(String(input));
    return json(
      pathname.startsWith("/api/v9/projects/")
        ? project
        : pathname.startsWith("/api/v2/teams/")
          ? team
          : { teamId: scope.team, projectId: scope.project, bounds: [] },
    );
  });
  const api = createVercelApi({ ...scope, fetch });
  expect(await resolveScopeDisplay({ ...scope, api })).toEqual({
    team: team.slug,
    project: project.name,
  });
  expect(await hasProjectBounds({ ...scope, api })).toBe(false);
  expect(await hasProjectBounds({ ...scope, api })).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(4); // Two metadata reads and two policy reads.
});

test("does not reuse a failed display read as an empty policy", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new Error(scope.token));
  const api = createVercelApi({ ...scope, fetch });
  expect(await resolveScopeDisplay({ ...scope, api })).toEqual({
    team: scope.team,
    project: scope.project,
  });
  await expect(hasProjectBounds({ ...scope, api })).rejects.toThrow(/Bounds/);
  expect(fetch).toHaveBeenCalledTimes(3);
});

const failures: [string, () => Promise<Response>][] = [
  ...[
    201, 202, 204, 206, 301, 302, 304, 307, 308, 400, 401, 403, 404, 429, 500,
    503,
  ].map(
    (status) =>
      [String(status), async () => new Response(null, { status })] as [
        string,
        () => Promise<Response>,
      ],
  ),
  [
    "followed redirect",
    async () => Object.defineProperty(json(), "redirected", { value: true }),
  ],
  ["invalid JSON", async () => new Response(scope.token)],
  [
    "transport failure",
    async () => {
      throw new Error(scope.token);
    },
  ],
];
test.each(failures)(
  "rejects %s at every request without retries",
  async (_name, fail) => {
    for (const failAt of [0, 1, 2]) {
      const fetch = fetchWith();
      for (let i = 0; i < failAt; i++) fetch.mockResolvedValueOnce(json());
      fetch.mockImplementationOnce(fail);
      await expect(read(fetch)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(failAt + 1);
    }
  },
);

test("uses only same-origin GETs with the supplied token and no cookies or body", async () => {
  const fetch = fetchWith();
  await read(fetch);
  for (const [url, init] of fetch.mock.calls) {
    expect(new URL(String(url)).origin).toBe("https://vercel.com");
    expect(init).toEqual({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: `Bearer ${scope.token}` },
      signal: expect.any(AbortSignal),
    });
  }
});

test("does not read an error response body", async () => {
  const body = vi.fn();
  const fetch = fetchWith().mockResolvedValue({
    status: 403,
    json: body,
  } as unknown as Response);
  await expect(read(fetch)).rejects.toThrow();
  expect(body).not.toHaveBeenCalled();
});

test.each([false, true])(
  "caller cancellation prevents requests, already aborted=%s",
  async (alreadyAborted) => {
    const controller = new AbortController();
    const fetch = fetchWith().mockImplementation(() => new Promise(() => {}));
    if (alreadyAborted) controller.abort();
    const result = expect(read(fetch, controller.signal)).rejects.toThrow();
    if (!alreadyAborted) controller.abort();
    await result;
    expect(fetch).toHaveBeenCalledTimes(alreadyAborted ? 0 : 1);
  },
);

test.each([false, true])(
  "bounds a hanging fetch even with caller signal=%s",
  async (withSignal) => {
    vi.useFakeTimers();
    const fetch = fetchWith().mockImplementation(() => new Promise(() => {}));
    const result = expect(
      read(fetch, withSignal ? new AbortController().signal : undefined),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test("bounds a hanging JSON read and prevents later requests even after it completes", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const response = json();
  vi.spyOn(response, "json").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const fetch = fetchWith().mockResolvedValue(response);
  const result = expect(read(fetch)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  finish({});
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("uses one deadline across successive reads", async () => {
  vi.useFakeTimers();
  const fetch = fetchWith();
  for (let i = 0; i < 2; i++)
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(json()), 4_000);
        }),
    );
  fetch.mockImplementationOnce(() => new Promise(() => {}));
  const result = expect(read(fetch)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[2][1]?.signal?.aborted).toBe(true);
});

test("cleans up deadlines on success and failure and defaults to global fetch", async () => {
  vi.useFakeTimers();
  const fetch = fetchWith();
  vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
  await createVercelApi(scope).run(100, (api) => api.get("/test"));
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  fetch.mockRejectedValue(new Error(scope.token));
  await expect(read(fetch)).rejects.toThrow();
  expect(vi.getTimerCount()).toBe(0);
});
