import { scope } from "../../src/args/scope.ts";
import { describe, test, expect, expectTypeOf, beforeEach, vi } from "vitest";
import * as cmd from "cmd-ts";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
}));

vi.mock("../../src/commands/login", () => ({
  login: { handler: vi.fn() },
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
    }>();
    expect(result.scope).toEqual({
      team: "team",
      project: "proj",
      token: "123",
    });
  });

  test("infers token from env var", async () => {
    process.env.VERCEL_AUTH_TOKEN = "from-env";
    const result = await cmd.run(command, ["--scope=team", "--project=proj"]);
    expectTypeOf(result.scope).toEqualTypeOf<{
      team: string;
      project: string;
      token: string;
    }>();
    expect(result.scope).toEqual({
      team: "team",
      project: "proj",
      token: "from-env",
    });
  });

  test("uses token's own claims for scope inference, not stale VERCEL_OIDC_TOKEN env var", async () => {
    // This test demonstrates the bug where:
    // 1. VERCEL_OIDC_TOKEN env var contains an old/expired token for project-A
    // 2. getVercelOidcToken() returns a DIFFERENT refreshed token for project-B
    // 3. inferScope uses the env var (project-A) but the actual token is for project-B
    // 4. API calls fail with 403 because token doesn't have access to project-A

    const { getVercelOidcToken } = await import("@vercel/oidc");

    // Create two different OIDC tokens with different project/team claims.
    // Note: We use a fake signature because inferScope only parses the JWT
    // payload for claims extraction - it doesn't validate the signature.
    const createOidcToken = (projectId: string, ownerId: string) => {
      const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
        "base64url",
      );
      const payload = Buffer.from(
        JSON.stringify({
          project_id: projectId,
          owner_id: ownerId,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const signature = "fake-signature";
      return `${header}.${payload}.${signature}`;
    };

    const oldToken = createOidcToken("old-project", "old-team");
    const newToken = createOidcToken("new-project", "new-team");

    // Env var has OLD token
    process.env.VERCEL_OIDC_TOKEN = oldToken;

    // But getVercelOidcToken returns NEW token (simulating refresh)
    vi.mocked(getVercelOidcToken).mockResolvedValue(newToken);

    const result = await cmd.run(command, []);

    // The token should be the NEW one
    expect(result.scope.token).toBe(newToken);

    // BUG: Currently, team/project come from OLD token (env var) not NEW token
    // This causes 403 errors because newToken doesn't have access to old-project/old-team
    //
    // EXPECTED (after fix): team/project should match the token being used
    expect(result.scope.team).toBe("new-team");
    expect(result.scope.project).toBe("new-project");
  });
});
