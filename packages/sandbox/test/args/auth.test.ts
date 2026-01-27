import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as cmd from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
}));

vi.mock("../../src/commands/login", () => ({
  login: { handler: vi.fn() },
}));

describe("token", () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    // Clear relevant env vars
    delete process.env.VERCEL_AUTH_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;

    // Create temp dir for auth config BEFORE any imports
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-auth-test-"));
    process.env.VERCEL_AUTH_CONFIG_DIR = tmpDir;

    // Mock fetch for OAuth calls
    fetchMock = vi.fn().mockImplementation(async (url: URL | string) => {
      const urlStr = url.toString();

      // OIDC discovery endpoint
      if (urlStr.includes(".well-known/openid-configuration")) {
        return Response.json({
          issuer: "https://vercel.com",
          device_authorization_endpoint: "https://vercel.com/oauth/device",
          token_endpoint: "https://vercel.com/oauth/token",
          revocation_endpoint: "https://vercel.com/oauth/revoke",
          jwks_uri: "https://vercel.com/.well-known/jwks.json",
          introspection_endpoint: "https://vercel.com/oauth/introspect",
        });
      }

      // Token refresh endpoint
      if (urlStr.includes("/oauth/token")) {
        return Response.json({
          access_token: "new-refreshed-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "new-refresh-token",
        });
      }

      throw new Error(`Unexpected fetch: ${urlStr}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.VERCEL_AUTH_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL_AUTH_CONFIG_DIR;
    vi.unstubAllGlobals();

    // Clean up temp dir
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("refreshToken behavior", () => {
    test("refreshes expired token and returns the new one", async () => {
      // Token that is ALREADY expired
      const authFile = {
        token: "expired-old-token",
        expiresAt: Math.floor((Date.now() - 60000) / 1000), // expired 1 minute ago
        refreshToken: "valid-refresh-token",
      };
      fs.writeFileSync(
        path.join(tmpDir, "auth.json"),
        JSON.stringify(authFile) + "\n",
      );

      const { token } = await import("../../src/args/auth.ts");

      const command = cmd.command({
        name: "test",
        args: { token },
        handler: (args) => args,
      });

      const result = await cmd.run(command, []);

      // Should return the refreshed token, not the expired one
      expect(result.token).toBe("new-refreshed-token");
    });
  });
});
