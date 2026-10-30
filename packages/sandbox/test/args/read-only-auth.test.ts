import * as cmd from "cmd-ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTokenOption } from "../../src/args/auth";
import { getVercelToken, getVercelOidcToken } from "@vercel/oidc";
import { getAuth } from "@vercel/sandbox/dist/auth/index.js";
vi.mock("@vercel/oidc", async (original) => ({
  ...(await original<typeof import("@vercel/oidc")>()),
  getVercelToken: vi.fn(),
  getVercelOidcToken: vi.fn(),
}));
vi.mock("@vercel/sandbox/dist/auth/index.js", async (original) => ({
  ...(await original<typeof import("@vercel/sandbox/dist/auth/index.js")>()),
  getAuth: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_AUTH_TOKEN", "");
  vi.stubEnv("VERCEL_TOKEN", "");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
});
afterEach(() => vi.unstubAllEnvs());
const parser = () =>
  cmd.command({
    name: "readonly",
    args: { token: createTokenOption(false, true) },
    handler: (args) => args,
  });
test("dry-run reads stored token without any refresh or login", async () => {
  vi.mocked(getAuth).mockReturnValue({ token: "stored-token" });
  expect((await cmd.run(parser(), [])).token).toBe("stored-token");
  expect(getVercelToken).not.toHaveBeenCalled();
  expect(getVercelOidcToken).not.toHaveBeenCalled();
});
test("dry-run uses raw OIDC env token instead of refreshing it", async () => {
  vi.stubEnv("VERCEL_OIDC_TOKEN", "raw-oidc");
  expect((await cmd.run(parser(), [])).token).toBe("raw-oidc");
  expect(getVercelOidcToken).not.toHaveBeenCalled();
});
test("dry-run without credentials fails with a hint, not login", async () => {
  vi.mocked(getAuth).mockReturnValue(null);
  expect((await cmd.runSafely(parser(), []))._tag).toBe("error");
  expect(getVercelToken).not.toHaveBeenCalled();
  expect(getVercelOidcToken).not.toHaveBeenCalled();
});
