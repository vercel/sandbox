import * as cmd from "cmd-ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CliError } from "../../src/util/cli-error";

const { mockCreate, mockGet, mockDecision } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockDecision: vi.fn(),
}));
vi.mock("../../src/client", () => ({
  sandboxClient: { create: mockCreate, get: mockGet },
}));
vi.mock("../../src/util/check-latest-version", () => ({
  startLatestVersionCheck: () => ({ report() {} }),
}));
vi.mock("../../src/util/execution-mode", () => ({
  resolveExecutionMode: async () => ({ interactive: true, json: false }),
}));
vi.mock("../../src/util/managed-credentials-review", async (original) => ({
  ...(await original<
    typeof import("../../src/util/managed-credentials-review")
  >()),
  promptReviewDecision: mockDecision,
}));
vi.mock("../../src/telemetry/agent", () => ({
  detectAgentName: async () => undefined,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockDecision.mockResolvedValue({ action: "cancel" });
});
afterEach(() => vi.restoreAllMocks());

test.each(["create", "run", "sh"] as const)(
  "%s prints its explicit command on rejection without creating a Sandbox",
  async (name) => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { create } = await import("../../src/commands/create");
    const { run } = await import("../../src/commands/run");
    const { sh } = await import("../../src/commands/sh");
    const commands = { create, run, sh };
    const root = cmd.subcommands({ name: "vercel sandbox", cmds: commands });
    const args = [
      name,
      "--scope=team",
      "--project=project",
      "--token=secret-rejection-test-token",
      "--credentials-repo=acme/widgets",
      "--credentials-action=issues:read",
      "--credentials-commit-as=Grace Hopper <grace@example.com>",
      "--credentials-act-as=42",
      "--vcpus=8",
    ];
    if (name === "run") args.push("--", "node", "-e", "console.log('hello')");
    try {
      await cmd.run(root, args);
      throw new Error("Expected the proposal to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const failure = error as CliError;
      expect(failure.options).toMatchObject({
        reason: "canceled",
        exitCode: 130,
      });
      const command = (failure.options.data as { command: string }).command;
      expect(command).toContain(`vercel sandbox ${name} `);
      expect(command).toContain("--scope=team");
      expect(command).toContain("--project=project");
      expect(command).toContain("--vcpus=8");
      expect(command).toContain("--credentials-repo=acme/widgets");
      expect(command).toContain("--credentials-action=github:issues:read");
      expect(command).toContain("--credentials-act-as=42");
      expect(command).not.toContain("--yes");
      expect(command).not.toContain("secret-rejection-test-token");
      if (name === "run") {
        expect(command).toContain("-- node -e ");
        expect(command).toContain("console.log");
      }
      expect(stderr.mock.calls.flat().join("")).toContain(command);
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  },
);
