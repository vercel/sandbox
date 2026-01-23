import { inferScope, selectTeam } from "./project";
import {
  beforeEach,
  describe,
  test,
  vi,
  Mock,
  expect,
  onTestFinished,
} from "vitest";
import { fetchApi } from "./api";
import { NotOk } from "./error";
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

describe("selectTeam", () => {
  test("returns the first team", async () => {
    fetchApiMock.mockResolvedValue({
      teams: [{ slug: "one" }, { slug: "two" }],
    });
    const team = await selectTeam("token");
    expect(fetchApiMock).toHaveBeenCalledWith({
      endpoint: "/v2/teams?limit=1",
      token: "token",
    });
    expect(team).toBe("one");
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

  describe("team creation", () => {
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

    test("non-404 throws", async () => {
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

  test("infers the team", async () => {
    fetchApiMock.mockImplementation(async ({ endpoint }) => {
      if (endpoint === "/v2/teams?limit=1") {
        return { teams: [{ slug: "inferred-team" }] };
      }
      return {};
    });
    const scope = await inferScope({ token: "token" });
    expect(scope).toEqual({
      created: false,
      projectId: "vercel-sandbox-default-project",
      teamId: "inferred-team",
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
