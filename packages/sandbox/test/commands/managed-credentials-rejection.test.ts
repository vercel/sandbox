import * as cmd from "cmd-ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CliError } from "../../src/util/cli-error";

const {
  mockCreate,
  mockGet,
  mockDecision,
  mockHasProjectBounds,
  mockBoundsAnswer,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockDecision: vi.fn(),
  mockHasProjectBounds: vi.fn(),
  mockBoundsAnswer: vi.fn(),
}));
vi.mock("../../src/client", () => ({
  sandboxClient: { create: mockCreate, get: mockGet },
}));
vi.mock("../../src/util/managed-credentials-project-bounds", () => ({
  hasProjectBounds: mockHasProjectBounds,
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
  question: mockBoundsAnswer,
}));
vi.mock("../../src/telemetry/agent", () => ({
  detectAgentName: async () => undefined,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_AUTH_TOKEN", "saved-auth-canary");
  mockDecision.mockResolvedValue({ action: "cancel" });
  mockHasProjectBounds.mockResolvedValue(true);
  mockBoundsAnswer.mockResolvedValue("n");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test.each(
  (["create", "run", "sh"] as const).flatMap((name) => [
    { name, rejectAt: "proposal" },
    { name, rejectAt: "no Bounds" },
  ]),
)(
  "$name prints its explicit command when rejecting $rejectAt without creating a Sandbox",
  async ({ name, rejectAt }) => {
    if (rejectAt === "no Bounds") {
      mockDecision.mockResolvedValue({ action: "create" });
      mockHasProjectBounds.mockResolvedValue(false);
    }
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
      ...(name === "run" && rejectAt === "proposal"
        ? []
        : name === "create"
          ? ["--token", "secret-rejection-test-token"]
          : ["--token=secret-rejection-test-token"]),
      "--credentials-github-repo=acme/widgets",
      "--credentials-github-action=issues:read",
      "--credentials-github-action=git:write",
      "--credentials-github-act-as=42",
      "--vcpus=8",
      "--env=PRIVATE_ENV=env-secret-canary",
      "--request-header=example.com:Authorization=header-secret-canary",
      "--credentials-github-persist-configuration=./not-written.json",
    ];
    if (name === "run")
      args.push(
        "--",
        "node",
        "-e",
        "console.log('hello')",
        "--token=child-token-canary",
      );
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
      expect(command).toMatch(/^vercel sandbox create /);
      expect(command).toContain("--scope=team");
      expect(command).toContain("--project=project");
      expect(command).toContain("--vcpus=8");
      expect(command).toContain("--credentials-github-repo=acme/widgets");
      expect(command).toContain(
        "--credentials-github-action=github:issues:read",
      );
      expect(command).toContain("--credentials-github-action=git:write");
      expect(command).toContain("--credentials-github-act-as=42");
      expect(command).not.toContain("--yes");
      expect(command).not.toContain("secret-rejection-test-token");
      if (name === "run" && rejectAt === "proposal")
        expect(command).not.toContain("--token");
      else
        expect(command).toContain(
          '--token="${VERCEL_AUTH_TOKEN:?Set VERCEL_AUTH_TOKEN to the original Vercel token}"',
        );
      for (const omitted of [
        "--env",
        "--request-header",
        "--credentials-github-persist-configuration",
        "env-secret-canary",
        "header-secret-canary",
        "console.log",
        "child-token-canary",
        "saved-auth-canary",
      ]) {
        expect(command).not.toContain(omitted);
      }
      expect(stderr.mock.calls.flat().join("")).toContain(command);
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    if (rejectAt === "no Bounds") {
      expect(mockHasProjectBounds).toHaveBeenCalledExactlyOnceWith({
        token: "secret-rejection-test-token",
        team: "team",
        project: "project",
        api: { run: expect.any(Function) },
      });
      expect(mockBoundsAnswer).toHaveBeenCalledWith(
        "Continue without project Bounds? (y/N) ",
        expect.any(Object),
      );
      expect(stderr.mock.calls.flat().join("")).toContain(
        "This project has no Bounds",
      );
    } else {
      expect(mockHasProjectBounds).not.toHaveBeenCalled();
    }
  },
);
