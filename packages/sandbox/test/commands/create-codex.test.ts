import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockCreate, mockExec, mockIsatty, mockSummary } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExec: vi.fn(),
  mockIsatty: vi.fn(),
  mockSummary: vi.fn(),
}));

vi.mock("node:tty", () => ({ isatty: mockIsatty }));
vi.mock("../../src/client", () => ({
  sandboxClient: { create: mockCreate, get: vi.fn(), list: vi.fn() },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
}));
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));
vi.mock("../../src/commands/login", () => ({ login: { handler: vi.fn() } }));
vi.mock("../../src/util/print-sandbox-summary", () => ({
  printSandboxSummary: mockSummary,
}));
vi.mock("../../src/util/check-latest-version", () => ({
  startLatestVersionCheck: () => ({ report: vi.fn() }),
}));
vi.mock("../../src/commands/exec", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/commands/exec")>();
  return { ...original, exec: { ...original.exec, handler: mockExec } };
});

const scopeArgs = ["--scope=team", "--project=proj", "--silent"];
const sandbox = {
  name: "agent-sandbox",
  interactivePort: 8443,
  runCommand: vi.fn(),
  routes: [],
  stop: vi.fn(),
  delete: vi.fn(),
};

async function createWith(args: string[]) {
  const { create } = await import("../../src/commands/create");
  return cmd.runSafely(create, [...args, ...scopeArgs]);
}

describe("create codex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sandbox.runCommand.mockResolvedValue({ exitCode: 0 });
    mockCreate.mockResolvedValue(sandbox);
    mockExec.mockResolvedValue(undefined);
    mockIsatty.mockReturnValue(true);
    vi.stubEnv("VERCEL_AUTH_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("creates the universal image and opens Codex exactly once", async () => {
    const result = await createWith(["codex", "--connect", "--timeout=10m"]);
    expect(result).toMatchObject({ _tag: "ok", value: sandbox });
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "vercel/sandbox/universal",
        persistent: true,
        timeout: 600000,
        env: {},
        __interactive: true,
      }),
    );
    expect(sandbox.runCommand).toHaveBeenCalledExactlyOnceWith({
      cmd: "codex",
      args: ["--version"],
      env: {},
    });
    expect(mockExec).toHaveBeenCalledExactlyOnceWith({
      command: "codex",
      args: ["--no-daemon"],
      cwd: undefined,
      scope: { token: "test-token", team: "team", project: "proj" },
      asSudo: false,
      skipExtendingTimeout: false,
      envVars: {},
      interactive: true,
      tty: true,
      sandbox,
      timeout: undefined,
    });
    expect(sandbox.stop).not.toHaveBeenCalled();
    expect(sandbox.delete).not.toHaveBeenCalled();
  });

  test.each([0, 1])(
    "rejects non-terminal fd %s before allocating a sandbox",
    async (fd) => {
      mockIsatty.mockImplementation((descriptor) => descriptor !== fd);
      await expect(createWith(["codex"])).rejects.toThrow(
        "requires a terminal (TTY)",
      );
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  test.each(["--runtime=node24", "--image=custom", "--snapshot=snap_123"])(
    "rejects conflicting %s before allocating a sandbox",
    async (flag) => {
      await expect(createWith(["codex", flag])).rejects.toThrow(
        "cannot be combined with --runtime, --image, or --snapshot",
      );
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  test("rejects unknown agents and extra positionals", async () => {
    expect(await createWith(["unknown"])).toMatchObject({ _tag: "error" });
    expect(await createWith(["codex", "extra"])).toMatchObject({
      _tag: "error",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("passes only explicit environment without agent defaults or host credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "host-only");
    vi.stubEnv("AI_GATEWAY_API_KEY", "host-only");
    vi.stubEnv("OPENCODE_DISABLE_AUTOUPDATE", "host-only");
    await createWith(["codex", "--env=EXPLICIT=value"]);
    expect(mockCreate.mock.calls[0][0].env).toEqual({ EXPLICIT: "value" });
    expect(mockExec.mock.calls[0][0].envVars).toEqual({ EXPLICIT: "value" });
  });

  test("accepts an explicitly supplied API key without printing it in hints", async () => {
    const output = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { create } = await import("../../src/commands/create");
    await cmd.runSafely(create, [
      "codex",
      "--scope=team",
      "--project=proj",
      "--env=OPENAI_API_KEY=test-only",
    ]);
    expect(mockCreate.mock.calls[0][0].env).toEqual({
      OPENAI_API_KEY: "test-only",
    });
    expect(mockExec.mock.calls[0][0].envVars).toEqual({
      OPENAI_API_KEY: "test-only",
    });
    expect(output.mock.calls.flat().join("\n")).not.toContain("test-only");
    expect(output.mock.calls.flat().join("\n")).toContain(
      "--env='OPENAI_API_KEY'",
    );
    expect(output.mock.calls.flat().join("\n")).toContain(
      "export the same --env values in your local shell",
    );
  });

  test("prints scoped reconnect and stop hints after disconnection", async () => {
    const output = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { create } = await import("../../src/commands/create");
    await cmd.runSafely(create, ["codex", "--scope=team", "--project=proj"]);
    expect(mockSummary).toHaveBeenCalledWith(
      expect.objectContaining({ connectHint: false }),
    );
    const text = output.mock.calls.flat().join("\n");
    expect(text).toContain("ℹ Exiting");
    expect(text).toContain("   │ Reconnect: ");
    expect(text).toContain("   ╰ Stop: ");
    expect(text).toContain(
      "sandbox exec --scope=team --project=proj --interactive agent-sandbox -- codex resume --last --no-daemon",
    );
    expect(text).toContain(
      "sandbox stop --scope=team --project=proj agent-sandbox",
    );
    expect(text).toContain("Exiting Codex does not stop the sandbox");
    const reconnect = text
      .split("\n")
      .find((line) => line.includes("Reconnect: "))!;
    const { exec } = await import("../../src/commands/exec");
    expect(
      await cmd.parse(
        exec,
        reconnect.split("Reconnect: sandbox exec ")[1].split(" "),
      ),
    ).toMatchObject({
      _tag: "ok",
      value: {
        command: "codex",
        args: ["resume", "--last", "--no-daemon"],
        interactive: true,
      },
    });
  });

  test.each([
    "connection failed",
    "codex: command not found",
    "Codex startup failed",
  ])("retains hints when attach rejects: %s", async (message) => {
    const output = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    mockExec.mockRejectedValue(new Error(message));
    const { create } = await import("../../src/commands/create");
    await expect(
      cmd.runSafely(create, ["codex", "--scope=team", "--project=proj"]),
    ).rejects.toThrow(message);
    expect(output.mock.calls.flat().join("\n")).toContain("sandbox stop");
    expect(sandbox.stop).not.toHaveBeenCalled();
    expect(sandbox.delete).not.toHaveBeenCalled();
  });

  test("does not attach after creation fails", async () => {
    mockCreate.mockRejectedValue(new Error("create failed"));
    await expect(createWith(["codex"])).rejects.toThrow("create failed");
    expect(mockExec).not.toHaveBeenCalled();
  });

  test("silent suppresses lifecycle hints, not the interactive session", async () => {
    const output = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await createWith(["codex"]);
    expect(mockExec).toHaveBeenCalledOnce();
    expect(output).not.toHaveBeenCalled();
    expect(mockSummary).not.toHaveBeenCalled();
  });

  test.each(["missing", "broken"])(
    "reports a %s binary before attaching and retains the stop hint",
    async (mode) => {
      if (mode === "missing")
        sandbox.runCommand.mockRejectedValue(new Error("ENOENT"));
      else sandbox.runCommand.mockResolvedValue({ exitCode: 1 });
      const output = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      const { create } = await import("../../src/commands/create");
      await expect(
        cmd.runSafely(create, ["codex", "--scope=team", "--project=proj"]),
      ).rejects.toThrow("Unable to start Codex (codex) in the sandbox.");
      expect(mockExec).not.toHaveBeenCalled();
      expect(output.mock.calls.flat().join("\n")).toContain(
        "sandbox stop --scope=team --project=proj agent-sandbox",
      );
      expect(sandbox.stop).not.toHaveBeenCalled();
    },
  );

  test.each([1, 127])(
    "retains remote exit code %s and stop hint",
    async (code) => {
      const previousExitCode = process.exitCode;
      const output = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      mockExec.mockImplementation(async () => {
        process.exitCode = code;
      });
      try {
        const { create } = await import("../../src/commands/create");
        await cmd.runSafely(create, [
          "codex",
          "--scope=team",
          "--project=proj",
        ]);
        expect(process.exitCode).toBe(code);
        expect(output.mock.calls.flat().join("\n")).toContain(
          "sandbox stop --scope=team --project=proj agent-sandbox",
        );
        expect(sandbox.stop).not.toHaveBeenCalled();
      } finally {
        process.exitCode = previousExitCode;
      }
    },
  );
});
