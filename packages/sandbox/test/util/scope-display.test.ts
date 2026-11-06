import { afterEach, describe, expect, test, vi } from "vitest";
import { isScopeId, resolveScopeDisplay } from "../../src/util/scope-display";

const TOKEN = "credential-canary-do-not-display";
const TEAM = "team_selected";
const PROJECT = "prj_selected";
const LEGACY_PROJECT = `Qm${"a".repeat(44)}`;
const TEAM_URL = `https://vercel.com/api/v2/teams/${TEAM}`;
const PROJECT_URL = `https://vercel.com/api/v9/projects/${PROJECT}?teamId=${TEAM}`;
const ORIGINAL_SCOPE = { team: TEAM, project: PROJECT };
const teamMetadata = { id: TEAM, slug: "selected-team" };
const projectMetadata = {
  id: PROJECT,
  accountId: TEAM,
  name: "selected-project",
};

function response(body: unknown): Response {
  return Response.json(body);
}

function options(fetch: typeof globalThis.fetch) {
  return { token: TOKEN, team: TEAM, project: PROJECT, fetch };
}

const lookup = (
  fetch: typeof globalThis.fetch,
  overrides: Partial<Parameters<typeof resolveScopeDisplay>[0]> = {},
) => resolveScopeDisplay({ ...options(fetch), ...overrides });

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scope ID detection", () => {
  test.each([
    ["team_selected", "team", true],
    ["team_", "team", true],
    ["prj_selected", "project", true],
    ["prj_", "project", true],
    [LEGACY_PROJECT, "project", true],
    [LEGACY_PROJECT, "team", false],
    ["team_selected", "project", false],
    ["prj_selected", "team", false],
    ["acme-team", "team", false],
    ["My Project (staging)", "project", false],
    ["Qm-short-name", "project", false],
    ["", "team", false],
  ] as const)("detects %s for %s", (value, kind, expected) => {
    expect(isScopeId(value, kind)).toBe(expected);
  });
});

describe("display-only names", () => {
  test("resolves linked IDs with two GETs, one token, and no input mutation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      switch (requestUrl(input)) {
        case TEAM_URL:
          return response(teamMetadata);
        case PROJECT_URL:
          return response(projectMetadata);
        default:
          throw new Error(`Unexpected request containing ${TOKEN}`);
      }
    });
    const input = Object.freeze(options(fetch));
    const before = { ...input };
    expect(await resolveScopeDisplay(input)).toEqual({
      team: "selected-team",
      project: "selected-project",
    });
    expect(input).toEqual(before);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => requestUrl(url)).sort()).toEqual(
      [TEAM_URL, PROJECT_URL].sort(),
    );
    const signals = new Set<AbortSignal>();
    for (const [, init] of fetch.mock.calls) {
      expect(init).toEqual({
        method: "GET",
        headers: { Authorization: `Bearer ${TOKEN}` },
        credentials: "omit",
        redirect: "error",
        signal: expect.any(AbortSignal),
      });
      signals.add(init!.signal!);
      expect(init).not.toHaveProperty("body");
    }
    expect(signals.size).toBe(1);
  });

  test("OIDC names need no fetch, even with conflicting display hints", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      await lookup(fetch, {
        team: "Acme, Inc. (R&D)",
        project: "München / web: staging_v2.0",
        teamSlug: "unrelated-team",
        projectSlug: "unrelated-project",
      }),
    ).toEqual({
      team: "Acme, Inc. (R&D)",
      project: "München / web: staging_v2.0",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("usable display hints avoid lookup for IDs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      await lookup(fetch, {
        teamSlug: "selected-team",
        projectSlug: "selected-project",
      }),
    ).toEqual({ team: "selected-team", project: "selected-project" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("team hints do not change the selected team ID for project lookup", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(projectMetadata));
    expect(await lookup(fetch, { teamSlug: "display-only" })).toEqual({
      team: "display-only",
      project: "selected-project",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestUrl(fetch.mock.calls[0][0])).toBe(PROJECT_URL);
  });

  test("a project hint does not suppress an independent team lookup", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(teamMetadata));
    expect(await lookup(fetch, { projectSlug: "display-only" })).toEqual({
      team: "selected-team",
      project: "display-only",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requestUrl(fetch.mock.calls[0][0])).toBe(TEAM_URL);
  });

  test.each([
    "",
    "   ",
    " padded ",
    "team_hidden",
    "prj_hidden",
    LEGACY_PROJECT,
    "line\nbreak",
    "escape\u001b[31m",
    "bidi\u202eunsafe",
    "invisible\u200bname",
  ])("ignores malformed or opaque slug hints (%j)", async (hint) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 403 }));
    expect(await lookup(fetch, { teamSlug: hint, projectSlug: hint })).toEqual(
      ORIGINAL_SCOPE,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("legacy project IDs are retained on failure and can be resolved by exact ID", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        response({ ...projectMetadata, id: LEGACY_PROJECT }),
      );
    const input = {
      ...options(fetch),
      team: "selected-team",
      project: LEGACY_PROJECT,
    };
    expect(await resolveScopeDisplay(input)).toEqual({
      team: "selected-team",
      project: LEGACY_PROJECT,
    });
    fetch.mockReset();
    fetch
      .mockResolvedValueOnce(
        response({ ...projectMetadata, id: LEGACY_PROJECT }),
      )
      .mockResolvedValueOnce(response(teamMetadata));
    expect(await resolveScopeDisplay(input)).toEqual({
      team: "selected-team",
      project: "selected-project",
    });
    expect(requestUrl(fetch.mock.calls[0][0])).toBe(
      `https://vercel.com/api/v9/projects/${LEGACY_PROJECT}?slug=selected-team`,
    );
  });

  test("uses the supplied fetch, or global fetch when omitted", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      response(requestUrl(url) === TEAM_URL ? teamMetadata : projectMetadata),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await resolveScopeDisplay({ token: TOKEN, team: TEAM, project: PROJECT }),
    ).toEqual({ team: "selected-team", project: "selected-project" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("untrusted metadata", () => {
  // HTTP, JSON and deadline permutations are owned by vercel-api.test.ts.
  test("does not display or log private transport errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error(TOKEN));
    expect(await lookup(fetch)).toEqual(ORIGINAL_SCOPE);
    expect(error).not.toHaveBeenCalled();
  });

  test.each(["team", "project"] as const)(
    "keeps the other name when %s metadata fails",
    async (failed) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const isTeam = requestUrl(input) === TEAM_URL;
        if (isTeam === (failed === "team")) throw new Error(TOKEN);
        return response(isTeam ? teamMetadata : projectMetadata);
      });
      expect(await lookup(fetch)).toEqual({
        team: failed === "team" ? ORIGINAL_SCOPE.team : "selected-team",
        project:
          failed === "project" ? ORIGINAL_SCOPE.project : "selected-project",
      });
    },
  );

  test("mismatched metadata retains the original selectors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      response(
        requestUrl(input) === TEAM_URL
          ? { ...teamMetadata, id: "team_another" }
          : { ...projectMetadata, accountId: "team_another" },
      ),
    );
    expect(await lookup(fetch)).toEqual(ORIGINAL_SCOPE);
  });

  test.each([
    "",
    " ",
    " padded ",
    "team_hidden",
    "prj_hidden",
    LEGACY_PROJECT,
    "line\nbreak",
    "tab\tname",
    "bell\u0007name",
    "c1\u009bname",
    "bidi\u202ename",
    "isolate\u2066name",
    "zero\u200bwidth",
    "line\u2028separator",
    "paragraph\u2029separator",
    "unpaired\ud800",
  ])("rejects unsafe or opaque metadata names (%j)", async (name) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      response(
        requestUrl(input) === TEAM_URL
          ? { ...teamMetadata, slug: name }
          : { ...projectMetadata, name },
      ),
    );
    expect(await lookup(fetch)).toEqual(ORIGINAL_SCOPE);
  });

  test("invalid supplied names are not displayed or used for requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      await lookup(fetch, { team: "\u202eevil", project: "\nunsafe" }),
    ).toEqual({
      team: "team name unavailable",
      project: "project name unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("project ID with a selected team slug", () => {
  test("verifies BOTH the returned owning team ID and the selected slug", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(projectMetadata))
      .mockResolvedValueOnce(response(teamMetadata));
    const input = Object.freeze({
      ...options(fetch),
      team: "selected-team",
      teamSlug: "different-display-hint",
    });
    expect(await resolveScopeDisplay(input)).toEqual({
      team: "selected-team",
      project: "selected-project",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requestUrl(fetch.mock.calls[0][0])).toBe(
      `https://vercel.com/api/v9/projects/${PROJECT}?slug=selected-team`,
    );
    expect(requestUrl(fetch.mock.calls[1][0])).toBe(TEAM_URL);
    expect(input.team).toBe("selected-team");
    expect(input.teamSlug).toBe("different-display-hint");
  });

  test.each([
    { ...teamMetadata, slug: "default-team" },
    { ...teamMetadata, id: "team_another" },
    { id: TEAM },
    { ...teamMetadata, slug: "selected-team\u202e" },
    null,
  ])(
    "rejects default-team fallthrough or malformed ownership (%j)",
    async (body) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response(projectMetadata))
        .mockResolvedValueOnce(response(body));
      expect(await lookup(fetch, { team: "selected-team" })).toEqual({
        team: "selected-team",
        project: ORIGINAL_SCOPE.project,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  test.each([undefined, "user_personal", "team_bad\nvalue", 42])(
    "does not try another account for invalid accountId (%j)",
    async (accountId) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(response({ ...projectMetadata, accountId }));
      expect(await lookup(fetch, { team: "selected-team" })).toEqual({
        team: "selected-team",
        project: ORIGINAL_SCOPE.project,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test("ownership read failure retains the original project ID", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(projectMetadata))
      .mockRejectedValueOnce(new Error(TOKEN));
    expect(await lookup(fetch, { team: "selected-team" })).toEqual({
      team: "selected-team",
      project: ORIGINAL_SCOPE.project,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("one total lookup deadline", () => {
  // Names are display metadata: a slow or hanging lookup must not delay the
  // command, and it falls back to the original selectors. The remaining abort
  // permutations are covered by the project-bounds client, which shares the
  // same bounded-GET shape and is the one that gates creation.
  test("bounds a fetch that ignores abort and keeps the original selectors", async () => {
    vi.useFakeTimers();
    const json = vi.fn(() => new Promise<unknown>(() => {}));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue({
      status: 200,
      redirected: false,
      json,
    } as unknown as Response);
    const result = lookup(fetch);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual(ORIGINAL_SCOPE);
    expect(fetch.mock.calls.every(([, init]) => init!.signal!.aborted)).toBe(
      true,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  test("clears the deadline after fast success", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      response(requestUrl(input) === TEAM_URL ? teamMetadata : projectMetadata),
    );
    expect(await lookup(fetch)).toEqual({
      team: "selected-team",
      project: "selected-project",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
