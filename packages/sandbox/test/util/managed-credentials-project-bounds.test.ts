import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CliError } from "../../src/util/cli-error";
import { inferScope } from "../../src/util/infer-scope";
import { hasProjectBounds } from "../../src/util/managed-credentials-project-bounds";

vi.mock("../../src/util/infer-scope", () => ({ inferScope: vi.fn() }));

const token = "private-token-never-print";
const scope = { token, team: "team_selected", project: "prj_selected" };
const project = {
  id: scope.project,
  accountId: scope.team,
  name: "selected-project",
};
const bound = {
  id: "bnd_selected",
  projectId: scope.project,
  teamId: scope.team,
  repositoryIds: [],
  actions: [],
  actAs: [],
};
const page = (bounds: unknown[] = [], next: string | null = null) => ({
  bounds,
  pagination: { next },
  displayNames: { githubUsers: {} },
});
const json = (body: unknown) => new Response(JSON.stringify(body));
const fetchWith = (...bodies: unknown[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const body of bodies) fetch.mockResolvedValueOnce(json(body));
  return fetch;
};
const urlAt = (fetch: ReturnType<typeof fetchWith>, index: number) =>
  new URL(String(fetch.mock.calls[index][0]));

async function policyUnknown(result: Promise<boolean>): Promise<CliError> {
  const error: unknown = await result.then(
    () => {
      throw new Error("Expected policy_unknown, not a Bounds presence result");
    },
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(CliError);
  expect((error as CliError).options).toEqual({ reason: "policy_unknown" });
  expect((error as CliError).message).toMatch(/Bounds/);
  expect((error as CliError).message).toMatch(/access|permissions/);
  return error as CliError;
}

beforeEach(() => {
  vi.clearAllMocks();
  // No test may reach the network, even if the implementation ignores injection.
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("No network")),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("exact project Bounds presence", () => {
  test("verifies explicit IDs before listing Bounds, including empty rights", async () => {
    const fetch = fetchWith(project, page([bound]));
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(urlAt(fetch, 0).href).toBe(
      "https://vercel.com/api/v9/projects/prj_selected?teamId=team_selected",
    );
    expect(urlAt(fetch, 1).href).toBe(
      "https://vercel.com/api/v1/git-credential-broker/bounds?teamId=team_selected&limit=100",
    );
  });

  test("presence does not depend on a particular repository or action", async () => {
    const fetch = fetchWith(
      project,
      page([
        { ...bound, repositoryIds: ["unrelated-repo"], actions: ["git:read"] },
      ]),
    );
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(true);
  });

  test("only requires Bound identity fields, not coverage or display metadata", async () => {
    const fetch = fetchWith(project, {
      bounds: [{ id: "bnd_one", teamId: scope.team, projectId: scope.project }],
      pagination: { next: null },
    });
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(true);
  });

  test("returns false for a verified project with no Bounds on the final page", async () => {
    const fetch = fetchWith(project, page());
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("does not count a different project, a prefix, or a case-insensitive match", async () => {
    const fetch = fetchWith(
      project,
      page([
        { ...bound, projectId: "prj_other" },
        { ...bound, projectId: "prj_selectedExtra" },
        { ...bound, projectId: "prj_SELECTED" },
      ]),
    );
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(false);
  });

  test("traverses unrelated and empty pages before finding an exact match", async () => {
    const cursor = "opaque+/cursor?teamId=team_wrong&limit=1#fragment";
    const fetch = fetchWith(
      project,
      page([{ ...bound, projectId: "prj_other" }], cursor),
      page([], "last-page"),
      page([bound], "not-needed"),
    );
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(urlAt(fetch, 2).searchParams.get("cursor")).toBe(cursor);
    expect(urlAt(fetch, 2).searchParams.getAll("teamId")).toEqual([scope.team]);
    expect(urlAt(fetch, 2).searchParams.getAll("limit")).toEqual(["100"]);
    expect(urlAt(fetch, 2).hash).toBe("");
    expect(urlAt(fetch, 3).searchParams.get("cursor")).toBe("last-page");
  });

  test("traverses all pages before returning false", async () => {
    const fetch = fetchWith(
      project,
      page([], "second"),
      page([{ ...bound, projectId: "prj_other" }], "third"),
      page(),
    );
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("read-only project and owning-team resolution", () => {
  test.each([
    ["team_selected", "selected-project", "teamId"],
    ["selected-team", "prj_selected", "slug"],
    ["edited-team", "edited-project", "slug"],
  ])("resolves team %s and project %s", async (team, selector, query) => {
    const fetch = fetchWith(
      {
        ...project,
        name: selector === project.id ? project.name : selector,
      },
      ...(query === "slug" ? [{ id: project.accountId, slug: team }] : []),
      page([bound]),
    );
    await expect(
      hasProjectBounds({ token, team, project: selector, fetch }),
    ).resolves.toBe(true);
    expect(urlAt(fetch, 0).pathname).toBe(`/api/v9/projects/${selector}`);
    expect([...urlAt(fetch, 0).searchParams]).toEqual([[query, team]]);
    const boundsIndex = query === "slug" ? 2 : 1;
    if (query === "slug") {
      expect(urlAt(fetch, 1).href).toBe(
        `https://vercel.com/api/v2/teams/${project.accountId}`,
      );
    }
    expect(fetch).toHaveBeenCalledTimes(boundsIndex + 1);
    expect([...urlAt(fetch, boundsIndex).searchParams]).toEqual([
      ["teamId", project.accountId],
      ["limit", "100"],
    ]);
  });

  test("encodes path and query selectors instead of allowing query or host injection", async () => {
    const selector = "edited/project?slug=wrong&x=%#fragment";
    const team = "edited-team&teamId=team_wrong#fragment";
    const fetch = fetchWith(
      { ...project, name: selector },
      { id: project.accountId, slug: team },
      page([bound]),
    );
    await expect(
      hasProjectBounds({ token, team, project: selector, fetch }),
    ).resolves.toBe(true);
    expect(urlAt(fetch, 0).origin).toBe("https://vercel.com");
    expect(urlAt(fetch, 0).pathname).toBe(
      `/api/v9/projects/${encodeURIComponent(selector)}`,
    );
    expect([...urlAt(fetch, 0).searchParams]).toEqual([["slug", team]]);
    expect(urlAt(fetch, 0).hash).toBe("");
  });

  test("uses the exact resolved IDs, not a slug, as the Bounds filter and team", async () => {
    const fetch = fetchWith(
      { id: "prj_edited", accountId: "team_edited", name: "edited-project" },
      { id: "team_edited", slug: "edited-team" },
      page([{ ...bound, teamId: "team_edited" }], "next"),
      page([{ ...bound, projectId: "prj_edited", teamId: "team_edited" }]),
    );
    await expect(
      hasProjectBounds({
        token,
        team: "edited-team",
        project: "edited-project",
        fetch,
      }),
    ).resolves.toBe(true);
    expect(urlAt(fetch, 1).pathname).toBe("/api/v2/teams/team_edited");
    expect(urlAt(fetch, 2).searchParams.get("teamId")).toBe("team_edited");
    expect(urlAt(fetch, 3).searchParams.get("teamId")).toBe("team_edited");
  });

  test.each([
    null,
    [],
    {},
    { ...project, id: undefined },
    { ...project, id: "" },
    { ...project, id: "selected-project" },
    { ...project, id: "prj_other" },
    { ...project, id: 123 },
    { ...project, accountId: undefined },
    { ...project, accountId: "" },
    { ...project, accountId: "user_private" },
    { ...project, accountId: "team_other" },
    { ...project, accountId: 123 },
    { ...project, name: undefined },
    { ...project, name: "" },
  ])("rejects malformed or mismatched project resolution: %j", async (body) => {
    const fetch = fetchWith(body, page());
    await policyUnknown(hasProjectBounds({ ...scope, fetch }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("rejects resolution of a different requested project slug", async () => {
    const fetch = fetchWith(project, page());
    await policyUnknown(
      hasProjectBounds({
        token,
        team: "selected-team",
        project: "edited-project",
        fetch,
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(["", " ", ".", "..", "bad\u0000selector"])(
    "rejects unsafe or missing selectors %j before requesting anything",
    async (selector) => {
      for (const options of [
        { ...scope, team: selector },
        { ...scope, project: selector },
      ]) {
        const fetch = fetchWith(project, page());
        await policyUnknown(hasProjectBounds({ ...options, fetch }));
        expect(fetch).not.toHaveBeenCalled();
      }
    },
  );
});

describe("fail-closed Bounds validation and pagination", () => {
  test.each([
    null,
    [],
    {},
    { bounds: null, pagination: { next: null } },
    { bounds: {}, pagination: { next: null } },
    { bounds: [] },
    { bounds: [], pagination: null },
    { bounds: [], pagination: {} },
    { bounds: [], pagination: { next: undefined } },
    { bounds: [], pagination: { next: false } },
    { bounds: [], pagination: { next: 1 } },
    { bounds: [], pagination: { next: "" } },
    { bounds: [], pagination: { next: "x".repeat(4097) } },
    page([null]),
    page([[]]),
    page([{}]),
    page([{ ...bound, id: undefined }]),
    page([{ ...bound, id: "" }]),
    page([{ ...bound, projectId: undefined }]),
    page([{ ...bound, projectId: "" }]),
    page([{ ...bound, projectId: 1 }]),
    page([{ ...bound, projectId: "selected-project" }]),
    page([{ ...bound, teamId: undefined }]),
    page([{ ...bound, teamId: "" }]),
    page([{ ...bound, teamId: "selected-team" }]),
    page([{ ...bound, teamId: "team_other" }]),
    page(Array.from({ length: 101 }, () => bound)),
  ])(
    "does not treat malformed or differently scoped data as empty: %j",
    async (body) => {
      const fetch = fetchWith(project, body);
      await policyUnknown(hasProjectBounds({ ...scope, fetch }));
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  test("validates every entry in a page before returning true", async () => {
    const fetch = fetchWith(
      project,
      page([bound, { ...bound, teamId: "team_other" }]),
    );
    await policyUnknown(hasProjectBounds({ ...scope, fetch }));
  });

  test("validates pagination even when a matching Bound is present", async () => {
    const fetch = fetchWith(project, { ...page([bound]), pagination: {} });
    await policyUnknown(hasProjectBounds({ ...scope, fetch }));
  });

  test("a malformed later page is not an empty project policy", async () => {
    const fetch = fetchWith(project, page([], "next"), { bounds: [] });
    await policyUnknown(hasProjectBounds({ ...scope, fetch }));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test.each([
    ["same", "same"],
    ["first", "second", "first"],
  ])("rejects cursor cycles %j", async (...cursors) => {
    const fetch = fetchWith(
      project,
      ...cursors.map((cursor) => page([], cursor)),
    );
    await policyUnknown(hasProjectBounds({ ...scope, fetch }));
    expect(fetch).toHaveBeenCalledTimes(1 + cursors.length);
  });

  test("bounds pages and requests even when every cursor is different", async () => {
    const fetch = fetchWith(
      project,
      ...Array.from({ length: 100 }, (_, index) => page([], `cursor-${index}`)),
    );
    await policyUnknown(hasProjectBounds({ ...scope, fetch }));
    expect(fetch).toHaveBeenCalledTimes(101);
  });

  test("can establish absence on the last allowed page", async () => {
    const fetch = fetchWith(
      project,
      ...Array.from({ length: 99 }, (_, index) => page([], `cursor-${index}`)),
      page(),
    );
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(101);
  });
});

describe("review regressions: exact teams and server project selectors", () => {
  const legacyId = `Qm${"a".repeat(44)}`;
  const selectedTeam = { id: scope.team, slug: "selected-team" };
  const slugScope = { ...scope, team: selectedTeam.slug };
  // Route-aware responses reproduce the old bug: an implementation that skips
  // team verification still gets a valid Bounds page, not a team-shaped error.
  const scopedFetch = (
    projectBody: unknown,
    teamBody: unknown,
    ...pages: unknown[]
  ) => {
    let index = 0;
    return vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) => {
        const { pathname } = new URL(String(input));
        if (pathname.startsWith("/api/v9/projects/")) return json(projectBody);
        if (pathname.startsWith("/api/v2/teams/")) return json(teamBody);
        if (
          pathname === "/api/v1/git-credential-broker/bounds" &&
          index < pages.length
        ) {
          return json(pages[index++]);
        }
        throw new Error("Unexpected test request");
      });
  };

  test("rejects a username slug that silently selected the caller's default team", async () => {
    const fetch = scopedFetch(
      { id: "prj_default", accountId: "team_default", name: "web" },
      { id: "team_default", slug: "actual-default-team" },
      page(),
    );
    await policyUnknown(
      hasProjectBounds({ token, team: "alice", project: "web", fetch }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(urlAt(fetch, 1).href).toBe(
      "https://vercel.com/api/v2/teams/team_default",
    );
    expect(
      fetch.mock.calls.some(([input]) => String(input).includes("/bounds")),
    ).toBe(false);
  });

  test.each([false, true])(
    "verifies the owning team's exact ID and slug before presence=%s",
    async (present) => {
      const fetch = scopedFetch(
        project,
        selectedTeam,
        page(present ? [bound] : []),
      );
      await expect(hasProjectBounds({ ...slugScope, fetch })).resolves.toBe(
        present,
      );
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(urlAt(fetch, 1).href).toBe(
        `https://vercel.com/api/v2/teams/${scope.team}`,
      );
      expect(urlAt(fetch, 2).searchParams.get("teamId")).toBe(scope.team);
      for (const [input, init] of fetch.mock.calls) {
        expect(new URL(String(input)).origin).toBe("https://vercel.com");
        expect(init).toMatchObject({
          method: "GET",
          redirect: "error",
          credentials: "omit",
        });
        expect(init?.headers).toEqual({ Authorization: `Bearer ${token}` });
        expect(init?.body).toBeUndefined();
      }
      expect(inferScope).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  // The team endpoint shares readJson with the project endpoint, so the HTTP
  // status, redirect, sanitization and deadline matrices are owned above and
  // not repeated here. Only team-identity verification is team-specific.
  test.each([
    null,
    { ...selectedTeam, id: "team_other" },
    { ...selectedTeam, slug: "other-team" },
    { ...selectedTeam, slug: undefined },
  ])(
    "rejects team metadata that does not verify the owning team #%#",
    async (teamBody) => {
      const fetch = scopedFetch(project, teamBody, page());
      await policyUnknown(hasProjectBounds({ ...slugScope, fetch }));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(urlAt(fetch, 1).pathname).toBe(`/api/v2/teams/${scope.team}`);
    },
  );

  test("a failed team read is never a fallback to the default team", async () => {
    const fetch = fetchWith(project);
    fetch.mockResolvedValueOnce(
      new Response("private-team-response", { status: 403 }),
    );
    const error = await policyUnknown(
      hasProjectBounds({ ...slugScope, fetch }),
    );
    expect(error.message).not.toContain("private-team-response");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.some(([input]) => String(input).includes("/bounds")),
    ).toBe(false);
  });

  test.each([false, true])(
    "bounds slug-based lookups to 102 requests, final-page absence=%s",
    async (finalPage) => {
      const fetch = scopedFetch(
        project,
        selectedTeam,
        ...Array.from({ length: 100 }, (_, index) =>
          page([], finalPage && index === 99 ? null : `cursor-${index}`),
        ),
      );
      const result = hasProjectBounds({ ...slugScope, fetch });
      if (finalPage) await expect(result).resolves.toBe(false);
      else await policyUnknown(result);
      expect(fetch).toHaveBeenCalledTimes(102);
    },
  );

  test.each([legacyId, "legacy-project"])(
    "accepts a legacy project selected by %s and traverses empty pages",
    async (selector) => {
      const fetch = fetchWith(
        { ...project, id: legacyId, name: "legacy-project" },
        page([], "last"),
        page(),
      );
      await expect(
        hasProjectBounds({ ...scope, project: selector, fetch }),
      ).resolves.toBe(false);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(urlAt(fetch, 1).searchParams.get("teamId")).toBe(scope.team);
    },
  );

  test("matches a Bound for the exact legacy project ID", async () => {
    const fetch = fetchWith(
      { ...project, id: legacyId },
      page([{ ...bound, projectId: legacyId }]),
    );
    await expect(
      hasProjectBounds({ ...scope, project: legacyId, fetch }),
    ).resolves.toBe(true);
  });

  test.each([false, true])(
    "does not reject or count an unrelated legacy Bound, presence=%s",
    async (present) => {
      const fetch = fetchWith(
        project,
        page([{ ...bound, projectId: legacyId }, ...(present ? [bound] : [])]),
      );
      await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(
        present,
      );
    },
  );

  test.each(["prj_demo", `prj_${"a".repeat(28)}`, legacyId])(
    "accepts exact project name %s regardless of ID-like spelling or length",
    async (name) => {
      const fetch = fetchWith({ ...project, name }, page());
      await expect(
        hasProjectBounds({ ...scope, project: name, fetch }),
      ).resolves.toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  test.each(["prj_demo", `prj_${"a".repeat(28)}`, legacyId])(
    "rejects a silent project switch when neither ID nor name matches %s",
    async (selector) => {
      const fetch = fetchWith(
        { ...project, id: "prj_other", name: "other-project" },
        page(),
      );
      await policyUnknown(
        hasProjectBounds({ ...scope, project: selector, fetch }),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});

describe("read errors, auth boundaries, and aborts", () => {
  test.each([301, 302, 307, 308, 400, 401, 403, 404, 429, 500, 503])(
    "rejects HTTP %i at either endpoint without redirects, retries, or auth fallback",
    async (status) => {
      for (const failAt of [0, 1, 2]) {
        const fetch = fetchWith(
          ...[project, page([], "next")].slice(0, failAt),
        );
        fetch.mockResolvedValueOnce(
          new Response("private response with account details", {
            status,
            headers: { Location: "https://untrusted.example/login" },
          }),
        );
        const error = await policyUnknown(
          hasProjectBounds({ ...scope, fetch }),
        );
        expect(error.message).not.toMatch(
          /private response|account details|untrusted/,
        );
        expect(fetch).toHaveBeenCalledTimes(failAt + 1);
        expect(inferScope).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
        for (const [input, init] of fetch.mock.calls) {
          expect(new URL(String(input)).origin).toBe("https://vercel.com");
          expect(init).toMatchObject({
            method: "GET",
            redirect: "error",
            credentials: "omit",
          });
          expect(init?.headers).toEqual({ Authorization: `Bearer ${token}` });
          expect(init?.body).toBeUndefined();
        }
      }
    },
  );

  test.each([0, 1, 2])("rejects invalid JSON at request %i", async (failAt) => {
    const fetch = fetchWith(...[project, page([], "next")].slice(0, failAt));
    fetch.mockResolvedValueOnce(new Response("secret-invalid-json"));
    const error = await policyUnknown(hasProjectBounds({ ...scope, fetch }));
    expect(error.message).not.toContain("secret-invalid-json");
    expect(fetch).toHaveBeenCalledTimes(failAt + 1);
  });

  test.each([0, 1, 2])(
    "sanitizes transport errors at request %i",
    async (failAt) => {
      const fetch = fetchWith(...[project, page([], "next")].slice(0, failAt));
      fetch.mockRejectedValueOnce(
        new Error(`Authorization: Bearer ${token}; private-account`),
      );
      const error = await policyUnknown(hasProjectBounds({ ...scope, fetch }));
      expect(error.message).not.toMatch(
        /Authorization|private-token|private-account/,
      );
      expect(error.cause).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(failAt + 1);
    },
  );

  test.each([201, 202, 204, 206, 304])(
    "rejects unexpected response status %i",
    async (status) => {
      for (const failAt of [0, 1]) {
        const fetch = fetchWith(...[project].slice(0, failAt));
        fetch.mockResolvedValueOnce(new Response(null, { status }));
        await policyUnknown(hasProjectBounds({ ...scope, fetch }));
        expect(fetch).toHaveBeenCalledTimes(failAt + 1);
      }
    },
  );

  test.each([0, 1])(
    "rejects an unexpectedly followed redirect at request %i",
    async (failAt) => {
      const response = json(failAt === 0 ? project : page());
      Object.defineProperty(response, "redirected", { value: true });
      const fetch = fetchWith(...[project].slice(0, failAt));
      fetch.mockResolvedValueOnce(response);
      await policyUnknown(hasProjectBounds({ ...scope, fetch }));
      expect(fetch).toHaveBeenCalledTimes(failAt + 1);
    },
  );

  test("uses only GETs and the supplied auth without scope inference or mutation", async () => {
    const fetch = fetchWith(project, page([], "next"), page([bound]));
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(true);
    for (const [input, init] of fetch.mock.calls) {
      expect(new URL(String(input)).origin).toBe("https://vercel.com");
      expect(init).toMatchObject({
        method: "GET",
        redirect: "error",
        credentials: "omit",
      });
      expect(init?.headers).toEqual({ Authorization: `Bearer ${token}` });
      expect(init?.body).toBeUndefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(inferScope).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("uses standard global fetch if no test transport is supplied", async () => {
    const fetch = fetchWith(project, page());
    vi.stubGlobal("fetch", fetch);
    await expect(hasProjectBounds(scope)).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a pre-aborted signal prevents all requests", async () => {
    const controller = new AbortController();
    controller.abort(new Error("private-abort-reason"));
    const fetch = fetchWith(project, page());
    const error = await policyUnknown(
      hasProjectBounds({ ...scope, fetch, signal: controller.signal }),
    );
    expect(error.message).not.toContain("private-abort-reason");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("caller cancellation aborts a request without waiting for an unresponsive transport", async () => {
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const result = policyUnknown(
      hasProjectBounds({ ...scope, fetch, signal: controller.signal }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    controller.abort();
    await result;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  test.each([false, true])(
    "a 10s total deadline bounds fetch even with caller signal=%s",
    async (withSignal) => {
      vi.useFakeTimers();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(() => new Promise(() => {}));
      const result = policyUnknown(
        hasProjectBounds({
          ...scope,
          fetch,
          ...(withSignal ? { signal: new AbortController().signal } : {}),
        }),
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await result;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test("the deadline includes reading the response body and prevents later requests", async () => {
    vi.useFakeTimers();
    let finishJson!: (value: unknown) => void;
    const response = json(project);
    vi.spyOn(response, "json").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishJson = resolve;
        }),
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const result = policyUnknown(hasProjectBounds({ ...scope, fetch }));
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    finishJson(project);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("the deadline is shared across project resolution and every Bounds page", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(json(project)), 4_000);
        }),
    );
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(json(page([], "next"))), 4_000);
        }),
    );
    fetch.mockImplementationOnce(() => new Promise(() => {}));
    const result = policyUnknown(hasProjectBounds({ ...scope, fetch }));
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][1]?.signal?.aborted).toBe(true);
  });

  test("cleans up its deadline on success and failure", async () => {
    vi.useFakeTimers();
    await expect(
      hasProjectBounds({ ...scope, fetch: fetchWith(project, page()) }),
    ).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await policyUnknown(hasProjectBounds({ ...scope, fetch: fetchWith({}) }));
    expect(vi.getTimerCount()).toBe(0);
  });
});
