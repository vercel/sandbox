import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import { defaultShell } from "../../src/interactive-shell/default-shell";

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
  routes: [],
  stop: vi.fn(),
  delete: vi.fn(),
};

async function createWith(args: string[]) {
  const { create } = await import("../../src/commands/create");
  return cmd.runSafely(create, [...args, ...scopeArgs]);
}

describe("create opencode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(sandbox);
    mockExec.mockResolvedValue(undefined);
    mockIsatty.mockReturnValue(true);
    vi.stubEnv("VERCEL_AUTH_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("creates the universal image and opens OpenCode exactly once", async () => {
    const result = await createWith(["opencode", "--connect", "--timeout=10m"]);
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
    expect(mockExec).toHaveBeenCalledExactlyOnceWith({
      command: "opencode",
      args: [],
      cwd: undefined,
      scope: { token: "test-token", team: "team", project: "proj" },
      asSudo: false,
      skipExtendingTimeout: false,
      envVars: { OPENCODE_DISABLE_AUTOUPDATE: "true" },
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
      await expect(createWith(["opencode"])).rejects.toThrow(
        "requires a terminal (TTY)",
      );
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  test.each(["--runtime=node24", "--image=custom", "--snapshot=snap_123"])(
    "rejects conflicting %s before allocating a sandbox",
    async (flag) => {
      await expect(createWith(["opencode", flag])).rejects.toThrow(
        "cannot be combined with --runtime, --image, or --snapshot",
      );
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  test("rejects unknown agents and extra positionals", async () => {
    expect(await createWith(["unknown"])).toMatchObject({ _tag: "error" });
    expect(await createWith(["opencode", "extra"])).toMatchObject({
      _tag: "error",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("passes only explicit environment and permits an explicit update override", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "host-only");
    vi.stubEnv("OPENAI_API_KEY", "host-only");
    await createWith([
      "opencode",
      "--env=EXPLICIT=value",
      "--env=OPENCODE_DISABLE_AUTOUPDATE=false",
    ]);
    const explicit = {
      EXPLICIT: "value",
      OPENCODE_DISABLE_AUTOUPDATE: "false",
    };
    expect(mockCreate.mock.calls[0][0].env).toEqual(explicit);
    expect(mockExec.mock.calls[0][0].envVars).toEqual(explicit);
  });

  test("prints scoped reconnect and stop hints after disconnection", async () => {
    const output = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { create } = await import("../../src/commands/create");
    await cmd.runSafely(create, ["opencode", "--scope=team", "--project=proj"]);
    expect(mockSummary).toHaveBeenCalledWith(
      expect.objectContaining({ connectHint: false }),
    );
    const text = output.mock.calls.flat().join("\n");
    expect(text).toContain("ℹ Exiting");
    expect(text).toContain("   │ Reconnect: ");
    expect(text).toContain("   ╰ Stop: ");
    expect(text).toContain(
      "sandbox exec --scope=team --project=proj --interactive --env=OPENCODE_DISABLE_AUTOUPDATE=true agent-sandbox -- opencode --continue",
    );
    expect(text).toContain(
      "sandbox stop --scope=team --project=proj agent-sandbox",
    );
    expect(text).toContain("Exiting OpenCode does not stop the sandbox");
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
      value: { command: "opencode", args: ["--continue"], interactive: true },
    });
  });

  test("prints lifecycle hints on connection failure without stopping or deleting", async () => {
    const output = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    mockExec.mockRejectedValue(new Error("connection failed"));
    const { create } = await import("../../src/commands/create");
    await expect(
      cmd.runSafely(create, ["opencode", "--scope=team", "--project=proj"]),
    ).rejects.toThrow("connection failed");
    expect(output.mock.calls.flat().join("\n")).toContain("sandbox stop");
    expect(sandbox.stop).not.toHaveBeenCalled();
    expect(sandbox.delete).not.toHaveBeenCalled();
  });

  test("does not attach after creation fails", async () => {
    mockCreate.mockRejectedValue(new Error("create failed"));
    await expect(createWith(["opencode"])).rejects.toThrow("create failed");
    expect(mockExec).not.toHaveBeenCalled();
  });

  test("silent suppresses lifecycle hints, not the interactive session", async () => {
    const output = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await createWith(["opencode"]);
    expect(mockExec).toHaveBeenCalledOnce();
    expect(output).not.toHaveBeenCalled();
    expect(mockSummary).not.toHaveBeenCalled();
  });

  test("plain create still works without a terminal and does not select an image", async () => {
    mockIsatty.mockReturnValue(false);
    expect(await createWith([])).toMatchObject({ _tag: "ok", value: sandbox });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("image");
    expect(mockExec).not.toHaveBeenCalled();
  });

  test("plain create --connect still opens the default shell", async () => {
    await createWith(["--connect"]);
    expect(mockExec).toHaveBeenCalledWith(
      expect.objectContaining({ ...defaultShell, envVars: {} }),
    );
  });

  test("plain create still accepts custom images, runtimes and snapshots", async () => {
    await createWith(["--image=custom"]);
    expect(mockCreate.mock.lastCall?.[0]).toHaveProperty("image", "custom");
    await createWith(["--runtime=node24"]);
    expect(mockCreate.mock.lastCall?.[0]).toHaveProperty("runtime", "node24");
    await createWith(["--snapshot=snap_123"]);
    expect(mockCreate.mock.lastCall?.[0]).toHaveProperty("source", {
      type: "snapshot",
      snapshotId: "snap_123",
    });
  });

  test("run still parses its executable rather than consuming an agent positional", async () => {
    const { run } = await import("../../src/commands/run");
    expect(
      await cmd.runSafely(run, [...scopeArgs, "--", "node", "--version"]),
    ).toMatchObject({ _tag: "ok" });
    expect(mockExec).toHaveBeenCalledWith(
      expect.objectContaining({ command: "node", args: ["--version"] }),
    );
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("image");
  });
});
