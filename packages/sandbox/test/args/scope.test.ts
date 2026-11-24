import { scope } from "../../src/args/scope.ts";
import { describe, test, expect, expectTypeOf, beforeEach, vi } from "vitest";
import * as cmd from "cmd-ts";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
}));

vi.mock("../../src/commands/login", () => ({
  login: { handler: vi.fn() },
}));

const { mockAuthInferScope } = vi.hoisted(() => ({
  mockAuthInferScope: vi.fn(),
}));
vi.mock("@vercel/sandbox/dist/auth/index.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@vercel/sandbox/dist/auth/index.js")
  >()),
  inferScope: mockAuthInferScope,
}));

describe("scope", () => {
  const command = cmd.command({
    name: "test",
    args: { scope },
    handler(args) {
      return args;
    },
  });

  beforeEach(() => {
    const env = { ...process.env };
    return () => {
      Object.assign(process.env, env);
      for (const key in process.env) {
        if (!(key in env)) {
          delete process.env[key];
        }
      }
    };
  });

  test("parses --scope=team --project=proj --token=123", async () => {
    const result = await cmd.run(command, [
      "--scope=team",
      "--project=proj",
      "--token=123",
    ]);
    expectTypeOf(result.scope).toEqualTypeOf<{
      team: string;
      project: string;
      token: string;
      projectSlug?: string;
      teamSlug?: string;
    }>();
    expect(result.scope).toEqual({
      team: "team",
      project: "proj",
      token: "123",
      projectSlug: undefined,
      teamSlug: undefined,
    });
  });

  describe("environment variables", () => {
    beforeEach(() => {
      delete process.env.VERCEL_TEAM_ID;
      delete process.env.VERCEL_ORG_ID;
      delete process.env.VERCEL_PROJECT_ID;
      mockAuthInferScope.mockImplementation(async ({ teamId }) => ({
        teamId: teamId ?? "team_default",
        projectId: "prj_default",
      }));
    });

    test("uses VERCEL_TEAM_ID and VERCEL_PROJECT_ID over the token's default project", async () => {
      process.env.VERCEL_TEAM_ID = "team_from_env";
      process.env.VERCEL_PROJECT_ID = "prj_from_env";

      const result = await cmd.run(command, ["--token=personal-token"]);
      expect(result.scope).toMatchObject({
        team: "team_from_env",
        project: "prj_from_env",
      });
    });

    test("reads VERCEL_ORG_ID when VERCEL_TEAM_ID is unset", async () => {
      process.env.VERCEL_ORG_ID = "team_from_org";
      process.env.VERCEL_PROJECT_ID = "prj_from_env";

      const result = await cmd.run(command, ["--token=personal-token"]);
      expect(result.scope).toMatchObject({
        team: "team_from_org",
        project: "prj_from_env",
      });
    });

    test("keeps --project over VERCEL_PROJECT_ID", async () => {
      process.env.VERCEL_TEAM_ID = "team_from_env";
      process.env.VERCEL_PROJECT_ID = "prj_from_env";

      const result = await cmd.run(command, [
        "--token=personal-token",
        "--project=prj_from_flag",
      ]);
      expect(result.scope).toMatchObject({
        team: "team_from_env",
        project: "prj_from_flag",
      });
    });

    test("infers the project within VERCEL_TEAM_ID when VERCEL_PROJECT_ID is unset", async () => {
      process.env.VERCEL_TEAM_ID = "team_from_env";

      const result = await cmd.run(command, ["--token=personal-token"]);
      expect(result.scope).toMatchObject({
        team: "team_from_env",
        project: "prj_default",
      });
    });
  });

  test("infers token from env var", async () => {
    process.env.VERCEL_AUTH_TOKEN = "from-env";
    const result = await cmd.run(command, ["--scope=team", "--project=proj"]);
    expectTypeOf(result.scope).toEqualTypeOf<{
      team: string;
      project: string;
      token: string;
      projectSlug?: string;
      teamSlug?: string;
    }>();
    expect(result.scope).toEqual({
      team: "team",
      project: "proj",
      token: "from-env",
      projectSlug: undefined,
      teamSlug: undefined,
    });
  });

  test("uses token's own claims for scope inference, not stale VERCEL_OIDC_TOKEN env var", async () => {
    const { getVercelOidcToken } = await import("@vercel/oidc");

    // Create two different OIDC tokens with different project/team claims.
    // Note: We use a fake signature because inferScope only parses the JWT
    // payload for claims extraction - it doesn't validate the signature.
    const createOidcToken = (
      projectId: string,
      ownerId: string,
      project: string,
      owner: string,
    ) => {
      const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
        "base64url",
      );
      const payload = Buffer.from(
        JSON.stringify({
          project_id: projectId,
          owner_id: ownerId,
          project,
          owner,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const signature = "fake-signature";
      return `${header}.${payload}.${signature}`;
    };

    const oldToken = createOidcToken(
      "old-project",
      "old-team",
      "old-project-slug",
      "old-team-slug",
    );
    const newToken = createOidcToken(
      "new-project",
      "new-team",
      "new-project-slug",
      "new-team-slug",
    );

    // Env var has OLD token
    process.env.VERCEL_OIDC_TOKEN = oldToken;

    // But getVercelOidcToken returns NEW token (simulating refresh)
    vi.mocked(getVercelOidcToken).mockResolvedValue(newToken);

    const result = await cmd.run(command, []);

    expect(result.scope.token).toBe(newToken);
    expect(result.scope.team).toBe("new-team");
    expect(result.scope.project).toBe("new-project");
  });
});
