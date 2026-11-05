import * as cmd from "cmd-ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createContext } from "../../src/args/create-context";
import { prepareManagedCredentials } from "../../src/util/managed-credentials-create";
import { CliError } from "../../src/util/cli-error";
import { getVercelToken } from "@vercel/oidc";
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
test("does not register a separate dry-run mode", async () => {
  expect(
    (
      await cmd.runSafely(parser, [
        "--scope=team",
        "--project=project",
        "--dry-run",
      ])
    )._tag,
  ).toBe("error");
  expect(
    createContext()
      .helpTopics()
      .some((topic) => topic.usage?.includes("--dry-run")),
  ).toBe(false);
});
test.each(["sandbox", "vercel sandbox"])(
  "includes the explicit rejected command for %s",
  async (appName) => {
    let context: Awaited<ReturnType<typeof parser.handler>> | undefined;
    const leaf = cmd.command({
      name: "create",
      args: { scope: createContext() },
      handler: (args) => {
        context = args.scope;
      },
    });
    const root = cmd.subcommands({ name: appName, cmds: { create: leaf } });
    await cmd.run(root, [
      "create",
      "--scope=team",
      "--project=project",
      "--json",
      "--credentials-github-repo=acme/widgets",
      "--credentials-github-action=issues:read",
      "--credentials-github-action=git:write",
      "--credentials-github-act-as=42",
      "--token=secret-test-token",
    ]);
    if (!context)
      throw new Error("The parser did not produce a creation context");
    try {
      await prepareManagedCredentials({ context, vcpus: 8 });
      throw new Error("Expected confirmation to be required");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const failure = error as CliError;
      expect(failure.options.reason).toBe("confirmation_required");
      const command = (failure.options.data as { command?: string }).command;
      expect(command).toBeTypeOf("string");
      expect(command).toContain(`${appName} create `);
      expect(command).toContain("--scope=team");
      expect(command).toContain("--project=project");
      expect(command).toContain("--vcpus=8");
      expect(command).toContain("--credentials-github-repo=acme/widgets");
      expect(command).toContain(
        "--credentials-github-action=github:issues:read",
      );
      expect(command).toContain("--credentials-github-action=git:write");
      expect(command).toContain("--credentials-github-act-as=42");
      expect(command).not.toContain("secret-test-token");
      expect(command).not.toContain("--yes");
      expect(command).not.toContain("create create");
    }
  },
);

test("invalid configuration is rejected before authentication", async () => {
  await expect(
    cmd.run(parser, [
      "--credentials-github-from-config-file=/nonexistent/sandbox-config.json",
    ]),
  ).rejects.toThrow("Can't read");
  expect(getVercelToken).not.toHaveBeenCalled();
});
test("execution syntax errors retain the requested JSON error mode", async () => {
  await expect(
    cmd.run(parser, ["--json", "--yes", "--yes"]),
  ).rejects.toMatchObject({ options: { json: true } });
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
