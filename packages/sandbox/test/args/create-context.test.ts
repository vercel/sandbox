import * as cmd from "cmd-ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createContext } from "../../src/args/create-context";
import { getVercelToken, getVercelOidcToken } from "@vercel/oidc";
import { getAuth } from "@vercel/sandbox/dist/auth/index.js";
vi.mock("@vercel/sandbox/dist/auth/index.js", async (original) => ({
  ...(await original<typeof import("@vercel/sandbox/dist/auth/index.js")>()),
  getAuth: vi.fn(),
}));
vi.mock("@vercel/oidc", async (original) => ({
  ...(await original<typeof import("@vercel/oidc")>()),
  getVercelToken: vi.fn(),
  getVercelOidcToken: vi.fn(),
}));
vi.mock("../../src/telemetry/agent", () => ({
  detectAgentName: vi.fn().mockResolvedValue(undefined),
}));
const parser = cmd.command({
  name: "create",
  args: { scope: createContext() },
  handler: (args) => args.scope,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_AUTH_TOKEN", "existing");
});
afterEach(() => vi.unstubAllEnvs());
test("bare interactive dry-run does not use normal authentication", async () => {
  vi.stubEnv("VERCEL_AUTH_TOKEN", "");
  vi.stubEnv("VERCEL_TOKEN", "");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  vi.mocked(getAuth).mockReturnValue({ token: "stored-read-only" });
  const stdin = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stderr = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: true,
  });
  vi.stubEnv("CI", "");
  try {
    const result = await cmd.run(parser, [
      "--dry-run",
      "--scope=team",
      "--project=project",
    ]);
    expect(result.dryRun).toBe(true);
    expect(result.creation).toEqual({});
    expect(result.token).toBe("stored-read-only");
    expect(getVercelToken).not.toHaveBeenCalled();
    expect(getVercelOidcToken).not.toHaveBeenCalled();
  } finally {
    if (stdin) Object.defineProperty(process.stdin, "isTTY", stdin);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (stderr) Object.defineProperty(process.stderr, "isTTY", stderr);
    else Reflect.deleteProperty(process.stderr, "isTTY");
  }
});
test("invalid configuration is rejected before authentication", async () => {
  await expect(
    cmd.run(parser, [
      "--credentials-from-config-file=/nonexistent/sandbox-config.json",
    ]),
  ).rejects.toThrow("Can't read");
  expect(getVercelToken).not.toHaveBeenCalled();
});
test.each([
  "--git-source",
  "--github-action",
  "--commit-as-name",
  "--managed-credentials-file",
])("does not register legacy %s", async (flag) => {
  expect(
    (
      await cmd.runSafely(parser, [
        "--scope=team",
        "--project=project",
        flag,
        "old",
      ])
    )._tag,
  ).toBe("error");
});
