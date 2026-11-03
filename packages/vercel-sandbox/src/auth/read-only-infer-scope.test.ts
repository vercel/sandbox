import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inferScope } from "./project.js";
import { fetchApi } from "./api.js";
import { NotOk } from "./error.js";

vi.mock("./api.js", () => ({ fetchApi: vi.fn() }));
const api = vi.mocked(fetchApi);
let cwd: string;

beforeEach(async () => {
  vi.resetAllMocks();
  cwd = await mkdtemp(join(tmpdir(), "sandbox-readonly-scope-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const noWrites = () =>
  expect(
    api.mock.calls.every(([request]) => (request.method ?? "GET") === "GET"),
  ).toBe(true);

function fixtures({
  defaultTeamId = "team_default" as string | null,
  projectStatus = 200,
  hobby = false,
} = {}) {
  api.mockImplementation(async ({ endpoint, method }) => {
    if (method === "POST") return {};
    if (endpoint === "/v2/user")
      return { user: { defaultTeamId, username: "personal" } };
    if (endpoint === "/v2/teams?limit=20")
      return {
        teams: hobby
          ? [
              {
                id: "team_hobby",
                slug: "personal",
                membership: { role: "OWNER" },
                billing: { plan: "hobby" },
              },
            ]
          : [],
        pagination: { count: hobby ? 1 : 0, next: null },
      };
    if (endpoint.startsWith("/v2/teams/")) return { slug: "default-team" };
    if (endpoint.startsWith("/v2/projects/")) {
      if (projectStatus !== 200)
        throw new NotOk({
          statusCode: projectStatus,
          responseText: "Project lookup failed",
        });
      return {};
    }
    throw new Error(`Unexpected request: ${endpoint}`);
  });
}

describe("read-only scope inference", () => {
  test("discovers the saved-login user's existing default scope with GET only", async () => {
    fixtures();
    const options = { token: "stored-token", cwd, readOnly: true };
    await expect(inferScope(options)).resolves.toMatchObject({
      teamId: "team_default",
      teamSlug: "default-team",
      projectId: "vercel-sandbox-default-project",
      created: false,
    });
    expect(api).toHaveBeenCalledWith({
      token: "stored-token",
      endpoint:
        "/v2/projects/vercel-sandbox-default-project?teamId=team_default",
    });
    noWrites();
  });

  test.each([
    ["explicit team", { teamId: "team_explicit" }, "team_default", false],
    ["default team", {}, "team_default", false],
    ["hobby owner team", {}, null, true],
    ["personal fallback", {}, null, false],
  ] as const)(
    "never creates a missing project for %s",
    async (_name, scope, defaultTeamId, hobby) => {
      fixtures({ defaultTeamId, hobby, projectStatus: 404 });
      const options = { token: "stored-token", cwd, readOnly: true, ...scope };
      await expect(inferScope(options)).rejects.toMatchObject({
        response: { statusCode: 404 },
      });
      noWrites();
    },
  );

  test("does not select another team just because the default project is missing", async () => {
    fixtures({ projectStatus: 404, hobby: true });
    const options = { token: "stored-token", cwd, readOnly: true };
    await expect(inferScope(options)).rejects.toMatchObject({
      response: { statusCode: 404 },
    });
    expect(api).not.toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/v2/teams?limit=20" }),
    );
    noWrites();
  });

  test.each([401, 403, 500])(
    "preserves lookup failure %s without any write",
    async (projectStatus) => {
      fixtures({ projectStatus });
      const options = {
        token: "stored-token",
        teamId: "team_explicit",
        cwd,
        readOnly: true,
      };
      await expect(inferScope(options)).rejects.toMatchObject({
        response: { statusCode: projectStatus },
      });
      noWrites();
    },
  );

  test("keeps the ordinary create-on-404 behavior when readOnly is absent", async () => {
    fixtures({ projectStatus: 404 });
    await expect(
      inferScope({ token: "stored-token", teamId: "team_explicit", cwd }),
    ).resolves.toMatchObject({ created: true });
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        endpoint: "/v11/projects?teamId=team_explicit",
      }),
    );
  });
});
