import { inferScope } from "./project.js";
import {
  beforeEach,
  describe,
  test,
  vi,
  Mock,
  expect,
  onTestFinished,
} from "vitest";
import { fetchApi } from "./api.js";
import { NotOk } from "./error.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const fetchApiMock = fetchApi as Mock<typeof fetchApi>;
vi.mock("./api");

beforeEach(() => {
  vi.clearAllMocks();
});

async function getTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infer-scope-test-"));
  onTestFinished(() => fs.rm(dir, { recursive: true }));
  return dir;
}

function mockUserAndTeams({
  defaultTeamId = null as string | null,
  username = "my-user",
  teams = [] as Array<{
    id: string;
    slug: string;
    updatedAt: number;
    membership: { role: string };
    billing: { plan: string };
  }>,
} = {}) {
  return (opts: { endpoint: string }) => {
    if (opts.endpoint === "/v2/user") {
      return Promise.resolve({ user: { defaultTeamId, username } });
    }
    if (opts.endpoint.startsWith("/v2/teams")) {
      return Promise.resolve({
        teams,
        pagination: { count: teams.length, next: null },
      });
    }
    return Promise.resolve({});
  };
}

describe("team selection from paginated results", () => {
  test("prefers personal team (matching username slug) over most recently updated", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: null,
        username: "my-user",
        teams: [
          {
            id: "team_other",
            slug: "other-team",
            updatedAt: 300,
            membership: { role: "OWNER" },
            billing: { plan: "hobby" },
          },
          {
            id: "team_personal",
            slug: "my-user",
            updatedAt: 100,
            membership: { role: "OWNER" },
            billing: { plan: "hobby" },
          },
        ],
      }),
    );

    const scope = await inferScope({ token: "token" });
    expect(scope.teamId).toBe("team_personal");
  });

  test("picks most recently updated hobby owner team when no username match", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: null,
        username: "my-user",
        teams: [
          {
            id: "team_old",
            slug: "old-team",
            updatedAt: 100,
            membership: { role: "OWNER" },
            billing: { plan: "hobby" },
          },
          {
            id: "team_recent",
            slug: "recent-team",
            updatedAt: 300,
            membership: { role: "OWNER" },
            billing: { plan: "hobby" },
          },
        ],
      }),
    );

    const scope = await inferScope({ token: "token" });
    expect(scope.teamId).toBe("team_recent");
  });

  test("filters out non-OWNER and non-hobby teams", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: null,
        username: "my-user",
        teams: [
          {
            id: "team_member",
            slug: "member-team",
            updatedAt: 300,
            membership: { role: "MEMBER" },
            billing: { plan: "hobby" },
          },
          {
            id: "team_pro",
            slug: "pro-team",
            updatedAt: 200,
            membership: { role: "OWNER" },
            billing: { plan: "pro" },
          },
          {
            id: "team_good",
            slug: "good-team",
            updatedAt: 100,
            membership: { role: "OWNER" },
            billing: { plan: "hobby" },
          },
        ],
      }),
    );

    const scope = await inferScope({ token: "token" });
    expect(scope.teamId).toBe("team_good");
  });

  test("falls back to username when no hobby owner teams found", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: null,
        username: "my-user",
        teams: [],
      }),
    );

    const scope = await inferScope({ token: "token" });
    expect(scope.teamId).toBe("my-user");
  });

  test("skips hobby team that matches already-tried defaultTeamId", async () => {
    fetchApiMock.mockImplementation(async ({ endpoint }) => {
      if (endpoint === "/v2/user") {
        return {
          user: { defaultTeamId: "team_abc", username: "my-user" },
        };
      }
      if (endpoint.startsWith("/v2/teams")) {
        return {
          teams: [
            {
              id: "team_abc",
              slug: "abc-team",
              updatedAt: 100,
              membership: { role: "OWNER" },
              billing: { plan: "hobby" },
            },
          ],
          pagination: { count: 1, next: null },
        };
      }
      // All project checks fail with 403
      throw new NotOk({ statusCode: 403, responseText: "Forbidden" });
    });

    await expect(inferScope({ token: "token" })).rejects.toThrowError(
      /none of the available teams allow sandbox creation/,
    );
    // team_abc tried once (defaultTeamId), then skipped in pagination, then username fallback
    const projectCalls = fetchApiMock.mock.calls.filter(([{ endpoint }]) =>
      endpoint.includes("vercel-sandbox-default-project"),
    );
    expect(projectCalls).toHaveLength(2);
  });

  test("paginates through multiple pages to find a usable team", async () => {
    fetchApiMock.mockImplementation(async ({ endpoint }) => {
      if (endpoint === "/v2/user") {
        return { user: { defaultTeamId: null, username: "my-user" } };
      }
      if (endpoint === "/v2/teams?limit=20") {
        return {
          teams: [
            {
              id: "team_pro",
              slug: "pro-team",
              updatedAt: 300,
              membership: { role: "OWNER" },
              billing: { plan: "pro" },
            },
          ],
          pagination: { count: 1, next: 12345 },
        };
      }
      if (endpoint === "/v2/teams?limit=20&until=12345") {
        return {
          teams: [
            {
              id: "team_hobby",
              slug: "hobby-team",
              updatedAt: 100,
              membership: { role: "OWNER" },
              billing: { plan: "hobby" },
            },
          ],
          pagination: { count: 1, next: null },
        };
      }
      return {};
    });

    const scope = await inferScope({ token: "token" });
    expect(scope.teamId).toBe("team_hobby");
  });
});

describe("inferScope", () => {
  test("uses provided teamId", async () => {
    fetchApiMock.mockResolvedValue({});
    const scope = await inferScope({ teamId: "my-team", token: "token" });
    expect(scope).toEqual({
      created: false,
      projectId: "vercel-sandbox-default-project",
      teamId: "my-team",
    });
  });

  describe("project creation", () => {
    test("project 404 triggers project creation", async () => {
      fetchApiMock.mockImplementation(async ({ method }) => {
        if (!method || method === "GET") {
          throw new NotOk({ statusCode: 404, responseText: "Not Found" });
        }
        return {};
      });
      const scope = await inferScope({ teamId: "my-team", token: "token" });
      expect(scope).toEqual({
        created: true,
        projectId: "vercel-sandbox-default-project",
        teamId: "my-team",
      });
    });

    test("non-404 throws when teamId is explicit", async () => {
      fetchApiMock.mockImplementation(async ({ method }) => {
        if (!method || method === "GET") {
          throw new NotOk({ statusCode: 403, responseText: "Forbidden" });
        }
        return {};
      });
      await expect(
        inferScope({ teamId: "my-team", token: "token" }),
      ).rejects.toThrowError(
        new NotOk({ statusCode: 403, responseText: "Forbidden" }),
      );
    });

    test("non-status errors are thrown", async () => {
      fetchApiMock.mockImplementation(async ({ method }) => {
        if (!method || method === "GET") {
          throw new Error("Oops!");
        }
        return {};
      });
      await expect(inferScope({ token: "token" })).rejects.toThrowError(
        "Oops!",
      );
    });
  });

  describe("fallback team selection with 403 handling", () => {
    test("falls back to hobby owner team when defaultTeamId returns 403", async () => {
      fetchApiMock.mockImplementation(async ({ endpoint }) => {
        if (endpoint === "/v2/user") {
          return {
            user: { defaultTeamId: "team_readonly", username: "my-user" },
          };
        }
        if (endpoint.startsWith("/v2/teams")) {
          return {
            teams: [
              {
                id: "team_writable",
                slug: "my-user",
                updatedAt: 100,
                membership: { role: "OWNER" },
                billing: { plan: "hobby" },
              },
            ],
            pagination: { count: 1, next: null },
          };
        }
        // Project check: 403 for readonly default team, success for owner team
        if (endpoint.includes("teamId=team_readonly")) {
          throw new NotOk({ statusCode: 403, responseText: "Forbidden" });
        }
        return {};
      });

      const scope = await inferScope({ token: "token" });
      expect(scope).toEqual({
        created: false,
        projectId: "vercel-sandbox-default-project",
        teamId: "team_writable",
        teamSlug: "my-user",
      });
    });

    test("throws helpful error when all candidates return 403", async () => {
      fetchApiMock.mockImplementation(async ({ endpoint }) => {
        if (endpoint === "/v2/user") {
          return {
            user: { defaultTeamId: "team_readonly", username: "my-user" },
          };
        }
        if (endpoint.startsWith("/v2/teams")) {
          return {
            teams: [
              {
                id: "team_owner",
                slug: "my-user",
                updatedAt: 200,
                membership: { role: "OWNER" },
                billing: { plan: "hobby" },
              },
            ],
            pagination: { count: 1, next: null },
          };
        }
        throw new NotOk({ statusCode: 403, responseText: "Forbidden" });
      });

      await expect(inferScope({ token: "token" })).rejects.toThrowError(
        /Authenticated as "my-user" but none of the available teams allow sandbox creation\. Specify a team explicitly with --scope/,
      );
    });

    test("uses defaultTeamId when it succeeds", async () => {
      fetchApiMock.mockImplementation(async ({ endpoint }) => {
        if (endpoint === "/v2/user") {
          return {
            user: { defaultTeamId: "team_default", username: "my-user" },
          };
        }
        if (endpoint.startsWith("/v2/teams")) {
          return { teams: [], pagination: { count: 0, next: null } };
        }
        return {};
      });

      const scope = await inferScope({ token: "token" });
      expect(scope).toEqual({
        created: false,
        projectId: "vercel-sandbox-default-project",
        teamId: "team_default",
      });
    });

    test("creates project in fallback team when it returns 404", async () => {
      fetchApiMock.mockImplementation(async ({ endpoint, method }) => {
        if (endpoint === "/v2/user") {
          return {
            user: { defaultTeamId: "team_default", username: "my-user" },
          };
        }
        if (endpoint.startsWith("/v2/teams")) {
          return { teams: [], pagination: { count: 0, next: null } };
        }
        if (
          endpoint.includes("teamId=team_default") &&
          (!method || method === "GET")
        ) {
          throw new NotOk({ statusCode: 404, responseText: "Not Found" });
        }
        return {};
      });

      const scope = await inferScope({ token: "token" });
      expect(scope).toEqual({
        created: true,
        projectId: "vercel-sandbox-default-project",
        teamId: "team_default",
      });
    });

    test("tries next candidate when project creation returns 403", async () => {
      fetchApiMock.mockImplementation(async ({ endpoint, method }) => {
        if (endpoint === "/v2/user") {
          return {
            user: { defaultTeamId: "team_nocreate", username: "my-user" },
          };
        }
        if (endpoint.startsWith("/v2/teams")) {
          return {
            teams: [
              {
                id: "team_good",
                slug: "good-team",
                updatedAt: 100,
                membership: { role: "OWNER" },
                billing: { plan: "hobby" },
              },
            ],
            pagination: { count: 1, next: null },
          };
        }
        // team_nocreate: project check 404, project creation 403
        if (endpoint.includes("teamId=team_nocreate")) {
          if (!method || method === "GET") {
            throw new NotOk({ statusCode: 404, responseText: "Not Found" });
          }
          throw new NotOk({ statusCode: 403, responseText: "Forbidden" });
        }
        // team_good: success
        return {};
      });

      const scope = await inferScope({ token: "token" });
      expect(scope).toEqual({
        created: false,
        projectId: "vercel-sandbox-default-project",
        teamId: "team_good",
        teamSlug: "good-team",
      });
    });
  });

  describe("linked project", () => {
    test("uses linked project when .vercel/project.json exists", async () => {
      const dir = await getTempDir();
      await fs.mkdir(path.join(dir, ".vercel"));
      await fs.writeFile(
        path.join(dir, ".vercel", "project.json"),
        JSON.stringify({
          projectId: "prj_linked",
          orgId: "team_linked",
        }),
      );

      fetchApiMock.mockImplementation(async ({ endpoint }) => {
        if (endpoint.includes("/v2/teams/")) {
          return { slug: "linked-team" };
        }
        if (endpoint.includes("/v2/projects/")) {
          return { name: "linked-project" };
        }
        return {};
      });

      const scope = await inferScope({ token: "token", cwd: dir });

      expect(scope).toEqual({
        created: false,
        projectId: "prj_linked",
        teamId: "team_linked",
        teamSlug: "linked-team",
        projectSlug: "linked-project",
      });
    });

    test("falls back to default project when .vercel/project.json does not exist", async () => {
      const dir = await getTempDir();
      fetchApiMock.mockResolvedValue({});

      const scope = await inferScope({
        token: "token",
        teamId: "my-team",
        cwd: dir,
      });

      expect(scope).toEqual({
        created: false,
        projectId: "vercel-sandbox-default-project",
        teamId: "my-team",
      });
      expect(fetchApiMock).toHaveBeenCalled();
    });

    test("falls back to default project when .vercel/project.json is invalid", async () => {
      const dir = await getTempDir();
      await fs.mkdir(path.join(dir, ".vercel"));
      await fs.writeFile(
        path.join(dir, ".vercel", "project.json"),
        "not valid json",
      );

      fetchApiMock.mockResolvedValue({});

      const scope = await inferScope({
        token: "token",
        teamId: "my-team",
        cwd: dir,
      });

      expect(scope).toEqual({
        created: false,
        projectId: "vercel-sandbox-default-project",
        teamId: "my-team",
      });
      expect(fetchApiMock).toHaveBeenCalled();
    });
  });
});
