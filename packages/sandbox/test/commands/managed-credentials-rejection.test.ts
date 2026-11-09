import * as cmd from "cmd-ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  isInteractive: async () => true,
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

test("omits recovery commands for file input even when direct flags could express it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sandbox-rejected-config-"));
  try {
    const path = join(directory, "credentials.json");
    await writeFile(
      path,
      JSON.stringify({
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["git:write"],
            actAs: "42",
          },
        ],
      }),
    );
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { create } = await import("../../src/commands/create");
    await expect(
      cmd.run(create, [
        "--scope=team",
        "--project=project",
        `--credentials-file=${path}`,
      ]),
    ).rejects.toMatchObject({ options: { reason: "canceled", exitCode: 130 } });
    const text = stderr.mock.calls.flat().join("");
    expect(text).toContain("Inferred Parameters");
    expect(text).not.toContain("Edit these explicit commands");
    expect(text).not.toContain("sandbox create");
    expect(text).not.toContain('"credentials"');
    expect(text).not.toContain("mktemp");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockHasProjectBounds).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
      const command = stderr.mock.calls
        .flat()
        .join("")
        .split("\n")
        .find((line) => line.startsWith("vercel sandbox create "))!;
      expect(command).toMatch(/^vercel sandbox create /);
      expect(command).toContain("--scope=team");
      expect(command).toContain("--project=project");
      expect(command).toContain("--vcpus=8");
      expect(command).toContain("--credentials-github-repo=acme/widgets");
      expect(command).toContain(
        "--credentials-github-action=github:issues:read,git:write",
      );
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
