import { describe, test, expect, vi, beforeEach } from "vitest";
import * as cmd from "cmd-ts";
import {
  AccessTokenMissingError,
  RefreshAccessTokenFailedError,
} from "@vercel/oidc";

const { mockGetVercelCliToken, mockGetVercelOidcToken, mockLogin } =
  vi.hoisted(() => ({
    mockGetVercelCliToken: vi.fn(),
    mockGetVercelOidcToken: vi.fn(),
    mockLogin: vi.fn(),
  }));

vi.mock("@vercel/oidc", async () => {
  const actual = await vi.importActual<typeof import("@vercel/oidc")>(
    "@vercel/oidc",
  );
  return {
    ...actual,
    getVercelToken: mockGetVercelCliToken,
    getVercelOidcToken: mockGetVercelOidcToken,
  };
});

vi.mock("../../src/commands/login", () => ({
  login: { handler: mockLogin },
}));

describe("token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Clear relevant env vars
    delete process.env.VERCEL_AUTH_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
  });

  describe("environment variable fallbacks", () => {
    test("uses VERCEL_AUTH_TOKEN when set", async () => {
      process.env.VERCEL_AUTH_TOKEN = "env-auth-token";

      const { token } = await import("../../src/args/auth.ts");

      const command = cmd.command({
        name: "test",
        args: { token },
        handler: (args) => args,
      });

      const result = await cmd.run(command, []);

      expect(result.token).toBe("env-auth-token");
      expect(mockGetVercelCliToken).not.toHaveBeenCalled();
    });

    test("uses VERCEL_OIDC_TOKEN and calls getVercelOidcToken when set", async () => {
      process.env.VERCEL_OIDC_TOKEN = "existing-oidc-token";
      mockGetVercelOidcToken.mockResolvedValue("refreshed-oidc-token");

      const { token } = await import("../../src/args/auth.ts");

      const command = cmd.command({
        name: "test",
        args: { token },
        handler: (args) => args,
      });

      const result = await cmd.run(command, []);

      expect(result.token).toBe("refreshed-oidc-token");
      expect(mockGetVercelOidcToken).toHaveBeenCalled();
      expect(mockGetVercelCliToken).not.toHaveBeenCalled();
    });

    test("falls back to getVercelToken when no env vars set", async () => {
      mockGetVercelCliToken.mockResolvedValue("cli-token");

      const { token } = await import("../../src/args/auth.ts");

      const command = cmd.command({
        name: "test",
        args: { token },
        handler: (args) => args,
      });

      const result = await cmd.run(command, []);

      expect(result.token).toBe("cli-token");
      expect(mockGetVercelCliToken).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    test("triggers login when getVercelToken throws AccessTokenMissingError", async () => {
      mockGetVercelCliToken
        .mockRejectedValueOnce(new AccessTokenMissingError())
        .mockResolvedValueOnce("token-after-login");
      mockLogin.mockResolvedValue(undefined);

      const { token } = await import("../../src/args/auth.ts");

      const command = cmd.command({
        name: "test",
        args: { token },
        handler: (args) => args,
      });

      const result = await cmd.run(command, []);

      expect(mockLogin).toHaveBeenCalled();
      expect(mockGetVercelCliToken).toHaveBeenCalledTimes(2);
      expect(result.token).toBe("token-after-login");
    });

    test("triggers login when getVercelToken throws RefreshAccessTokenFailedError", async () => {
      mockGetVercelCliToken
        .mockRejectedValueOnce(new RefreshAccessTokenFailedError())
        .mockResolvedValueOnce("token-after-login");
      mockLogin.mockResolvedValue(undefined);

      const { token } = await import("../../src/args/auth.ts");

      const command = cmd.command({
        name: "test",
        args: { token },
        handler: (args) => args,
      });

      const result = await cmd.run(command, []);

      expect(mockLogin).toHaveBeenCalled();
      expect(mockGetVercelCliToken).toHaveBeenCalledTimes(2);
      expect(result.token).toBe("token-after-login");
    });
  });
});
