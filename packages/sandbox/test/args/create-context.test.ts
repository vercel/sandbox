import * as cmd from "cmd-ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createContext } from "../../src/args/create-context";
import { prepareManagedCredentials } from "../../src/util/managed-credentials-create";
import { CliError } from "../../src/util/cli-error";
import { getVercelToken } from "@vercel/oidc";
import { fetchSandboxCredentialSnapshot } from "../../src/util/managed-credentials-client";
vi.mock("../../src/util/managed-credentials-client", () => ({
  fetchSandboxCredentialSnapshot: vi.fn(),
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
test.each(["--dry-run", "--json"])("does not register %s", async (flag) => {
  expect(
    (await cmd.runSafely(parser, ["--scope=team", "--project=project", flag]))
      ._tag,
  ).toBe("error");
  expect(
    createContext()
      .helpTopics()
      .some((topic) => topic.usage?.includes(flag)),
  ).toBe(false);
});
test.each(["sandbox", "vercel sandbox"])(
  "includes the explicit rejected command for %s",
  async (appName) => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
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
      "--non-interactive",
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
      const command = stderr.mock.calls.flat().join("");
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
test("rejects repeated approval flags", async () => {
  await expect(cmd.run(parser, ["--yes", "--yes"])).rejects.toBeInstanceOf(
    CliError,
  );
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

test("reuse lookup failures are safe CLI errors", async () => {
  vi.mocked(fetchSandboxCredentialSnapshot).mockRejectedValueOnce(
    new Error("private-response-canary"),
  );
  const error = await cmd
    .run(parser, [
      "--scope=team",
      "--project=project",
      "--credentials-github-from-sandbox=source",
    ])
    .catch((error) => error);
  expect(error).toBeInstanceOf(CliError);
  expect(error.options).toMatchObject({
    reason: "configuration_lookup_failed",
    exitCode: 1,
  });
  expect(error.message).not.toContain("private-response-canary");
  expect(error.cause).toBeUndefined();
  expect(fetchSandboxCredentialSnapshot).toHaveBeenCalledOnce();
});
