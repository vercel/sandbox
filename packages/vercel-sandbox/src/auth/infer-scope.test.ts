import { inferScope, selectTeams } from "./project.js";
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
  }>,
} = {}) {
  return (opts: { endpoint: string }) => {
    if (opts.endpoint === "/v2/user") {
      return Promise.resolve({ user: { defaultTeamId, username } });
    }
    if (opts.endpoint.startsWith("/v2/teams")) {
      return Promise.resolve({ teams });
    }
    return Promise.resolve({});
  };
}

describe("selectTeams", () => {
  test("returns defaultTeamId first, then best owner team", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: "team_default",
        username: "my-user",
        teams: [
          {
            id: "team_default",
            slug: "default-team",
            updatedAt: 100,
            membership: { role: "OWNER" },
          },
          {
            id: "team_other",
            slug: "other-team",
            updatedAt: 200,
            membership: { role: "OWNER" },
          },
        ],
      }),
    );

    const result = await selectTeams("token");
    // defaultTeamId is also the best owner match, so only one candidate
    expect(result.candidateTeamIds).toEqual(["team_default", "team_other"]);
    expect(result.username).toBe("my-user");
  });

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
          },
          {
            id: "team_personal",
            slug: "my-user",
            updatedAt: 100,
            membership: { role: "OWNER" },
          },
        ],
      }),
    );

    const result = await selectTeams("token");
    expect(result.candidateTeamIds).toEqual(["team_personal"]);
  });

  test("picks most recently updated owner team when no username match", async () => {
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
          },
          {
            id: "team_recent",
            slug: "recent-team",
            updatedAt: 300,
            membership: { role: "OWNER" },
          },
        ],
      }),
    );

    const result = await selectTeams("token");
    expect(result.candidateTeamIds).toEqual(["team_recent"]);
  });

  test("filters out non-OWNER teams", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: null,
        username: "my-user",
        teams: [
          {
            id: "team_owner",
            slug: "owner-team",
            updatedAt: 100,
            membership: { role: "OWNER" },
          },
          {
            id: "team_member",
            slug: "member-team",
            updatedAt: 200,
            membership: { role: "MEMBER" },
          },
        ],
      }),
    );

    const result = await selectTeams("token");
    expect(result.candidateTeamIds).toEqual(["team_owner"]);
  });

  test("falls back to username when no teams and no defaultTeamId", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: null,
        username: "my-user",
        teams: [],
      }),
    );

    const result = await selectTeams("token");
    expect(result.candidateTeamIds).toEqual(["my-user"]);
  });

  test("does not duplicate defaultTeamId when it matches best owner team", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: "team_abc",
        username: "my-user",
        teams: [
          {
            id: "team_abc",
            slug: "abc-team",
            updatedAt: 100,
            membership: { role: "OWNER" },
          },
        ],
      }),
    );

    const result = await selectTeams("token");
    expect(result.candidateTeamIds).toEqual(["team_abc"]);
  });

  test("defaultTeamId may differ from best owner team", async () => {
    fetchApiMock.mockImplementation(
      mockUserAndTeams({
        defaultTeamId: "team_nonowner",
        username: "my-user",
        teams: [
          {
            id: "team_owner",
            slug: "my-user",
            updatedAt: 100,
            membership: { role: "OWNER" },
          },
          {
            id: "team_nonowner",
            slug: "nonowner-team",
            updatedAt: 200,
            membership: { role: "MEMBER" },
          },
        ],
      }),
    );

    const result = await selectTeams("token");
    // defaultTeamId first (even though not OWNER), then best owner team as fallback
    expect(result.candidateTeamIds).toEqual(["team_nonowner", "team_owner"]);
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
    test("falls back to owner team when defaultTeamId returns 403", async () => {
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
              },
            ],
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
              },
            ],
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
          return { teams: [] };
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
          return { teams: [] };
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
              },
            ],
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

      const scope = await inferScope({ token: "token", cwd: dir });

      expect(scope).toEqual({
        created: false,
        projectId: "prj_linked",
        teamId: "team_linked",
      });
      // Should not call API when using linked project
      expect(fetchApiMock).not.toHaveBeenCalled();
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
