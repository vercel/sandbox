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

describe("create pi", () => {
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

  test("creates the universal image and opens Pi exactly once", async () => {
    const result = await createWith(["pi", "--connect", "--timeout=10m"]);
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
      cmd: "pi",
      args: ["--version"],
      env: {},
    });
    expect(mockExec).toHaveBeenCalledExactlyOnceWith({
      command: "pi",
      args: [],
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
      await expect(createWith(["pi"])).rejects.toThrow(
        "requires a terminal (TTY)",
      );
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  test.each(["--runtime=node24", "--image=custom", "--snapshot=snap_123"])(
    "rejects conflicting %s before allocating a sandbox",
    async (flag) => {
      await expect(createWith(["pi", flag])).rejects.toThrow(
        "cannot be combined with --runtime, --image, or --snapshot",
      );
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  test("rejects unknown agents and extra positionals", async () => {
    expect(await createWith(["unknown"])).toMatchObject({ _tag: "error" });
    expect(await createWith(["pi", "extra"])).toMatchObject({
      _tag: "error",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("passes only explicit environment without agent defaults or host credentials", async () => {
    vi.stubEnv("GEMINI_API_KEY", "host-only");
    vi.stubEnv("PI_CODING_AGENT_DIR", "/host/pi-config");
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", "/host/pi-sessions");
    vi.stubEnv("AI_GATEWAY_API_KEY", "host-only");
    vi.stubEnv("OPENCODE_DISABLE_AUTOUPDATE", "host-only");
    await createWith(["pi", "--env=EXPLICIT=value"]);
    expect(mockCreate.mock.calls[0][0].env).toEqual({ EXPLICIT: "value" });
    expect(mockExec.mock.calls[0][0].envVars).toEqual({ EXPLICIT: "value" });
  });

  test("accepts an explicitly supplied API key without printing it in hints", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const { create } = await import("../../src/commands/create");
    await cmd.runSafely(create, [
      "pi",
      "--scope=team",
      "--project=proj",
      "--env=GEMINI_API_KEY=test-only",
    ]);
    expect(mockCreate.mock.calls[0][0].env).toEqual({
      GEMINI_API_KEY: "test-only",
    });
    expect(mockExec.mock.calls[0][0].envVars).toEqual({
      GEMINI_API_KEY: "test-only",
    });
    const text = output.mock.calls.flat().join("\n");
    expect(text).not.toContain("test-only");
    expect(text).toContain("--env='GEMINI_API_KEY'");
    expect(text).toContain("export the same --env values in your local shell");
  });

  test("prints scoped reconnect and stop hints after disconnection", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const { create } = await import("../../src/commands/create");
    await cmd.runSafely(create, ["pi", "--scope=team", "--project=proj"]);
    expect(mockSummary).toHaveBeenCalledWith(
      expect.objectContaining({ connectHint: false }),
    );
    const text = output.mock.calls.flat().join("\n");
    expect(text).toContain(
      "sandbox exec --scope=team --project=proj --interactive agent-sandbox -- pi --continue",
    );
    expect(text).toContain(
      "sandbox stop --scope=team --project=proj agent-sandbox",
    );
    expect(text).toContain("Exiting Pi does not stop the sandbox");
    const reconnect = text
      .split("\n")
      .find((line) => line.startsWith("Reconnect: "))!;
    const { exec } = await import("../../src/commands/exec");
    expect(
      await cmd.parse(
        exec,
        reconnect.replace("Reconnect: sandbox exec ", "").split(" "),
      ),
    ).toMatchObject({
      _tag: "ok",
      value: { command: "pi", args: ["--continue"], interactive: true },
    });
  });

  test.each([
    "connection failed",
    "pi: command not found",
    "Pi startup failed",
  ])("retains hints when attach rejects: %s", async (message) => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExec.mockRejectedValue(new Error(message));
    const { create } = await import("../../src/commands/create");
    await expect(
      cmd.runSafely(create, ["pi", "--scope=team", "--project=proj"]),
    ).rejects.toThrow(message);
    expect(output.mock.calls.flat().join("\n")).toContain("sandbox stop");
    expect(sandbox.stop).not.toHaveBeenCalled();
    expect(sandbox.delete).not.toHaveBeenCalled();
  });

  test("does not attach after creation fails", async () => {
    mockCreate.mockRejectedValue(new Error("create failed"));
    await expect(createWith(["pi"])).rejects.toThrow("create failed");
    expect(mockExec).not.toHaveBeenCalled();
  });

  test("silent suppresses lifecycle hints, not the interactive session", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    await createWith(["pi"]);
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
      const output = vi.spyOn(console, "error").mockImplementation(() => {});
      const { create } = await import("../../src/commands/create");
      await expect(
        cmd.runSafely(create, ["pi", "--scope=team", "--project=proj"]),
      ).rejects.toThrow("Unable to start Pi (pi) in the sandbox.");
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
      const output = vi.spyOn(console, "error").mockImplementation(() => {});
      mockExec.mockImplementation(async () => {
        process.exitCode = code;
      });
      try {
        const { create } = await import("../../src/commands/create");
        await cmd.runSafely(create, ["pi", "--scope=team", "--project=proj"]);
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
