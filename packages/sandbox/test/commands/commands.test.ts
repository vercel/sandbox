import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockGet, mockRunCommand, mockGetCommand, mockWait, mockKill } =
  vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockRunCommand: vi.fn(),
    mockGetCommand: vi.fn(),
    mockWait: vi.fn(),
    mockKill: vi.fn(),
  }));

vi.mock("../../src/client", () => ({
  sandboxClient: { get: mockGet },
}));
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

const scope = { token: "tok", team: "team", project: "proj" };
const commandArgs = ["my-sandbox", "cmd_1", "--scope=team", "--project=proj"];

describe("detached command lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_AUTH_TOKEN = "tok";
    mockRunCommand.mockResolvedValue({ cmdId: "cmd_1" });
    mockWait.mockResolvedValue({ exitCode: 0 });
    mockGetCommand.mockResolvedValue({
      cmdId: "cmd_1",
      exitCode: null,
      logs: async function* () {
        yield { stream: "stdout", data: "ready\n" };
      },
      wait: mockWait,
      kill: mockKill,
    });
    mockGet.mockResolvedValue({
      runCommand: mockRunCommand,
      currentSession: () => ({ status: "running", getCommand: mockGetCommand }),
    });
  });

  test("detached exec prints the ID and does not wait for the command", async () => {
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const { exec } = await import("../../src/commands/exec.ts");
      await exec.handler({
        sandbox: "my-sandbox",
        command: "node",
        args: ["server.js"],
        scope,
        asSudo: false,
        interactive: false,
        detached: true,
        stdin: false,
        skipExtendingTimeout: false,
        tty: false,
        cwd: undefined,
        envVars: {},
        timeout: undefined,
      });
      expect(mockRunCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: "node",
          args: ["server.js"],
          detached: true,
        }),
      );
      expect(output).toHaveBeenCalledWith("cmd_1\n");
    } finally {
      output.mockRestore();
    }
  });

  test("get and wait use the current session without resuming", async () => {
    const { commands } = await import("../../src/commands/commands.ts");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      await cmd.run(commands, ["get", ...commandArgs]);
      await cmd.run(commands, ["wait", ...commandArgs]);
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({ name: "my-sandbox", resume: false }),
      );
      expect(mockGetCommand).toHaveBeenCalledWith("cmd_1");
      expect(mockWait).toHaveBeenCalledTimes(1);
      expect(output).toHaveBeenCalledWith("cmd_1\trunning\n");
    } finally {
      output.mockRestore();
    }
  });

  test("streams command logs to stdout", async () => {
    const { commands } = await import("../../src/commands/commands.ts");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      await cmd.run(commands, ["logs", ...commandArgs]);
      expect(output).toHaveBeenCalledWith("ready\n");
    } finally {
      output.mockRestore();
    }
  });

  test("kill sends the requested signal to the command", async () => {
    const { commands } = await import("../../src/commands/commands.ts");
    await cmd.run(commands, ["kill", ...commandArgs, "--signal=SIGKILL"]);
    expect(mockKill).toHaveBeenCalledWith("SIGKILL");
  });

  test("rejects command lookup when the sandbox session is stopped", async () => {
    mockGet.mockResolvedValue({
      currentSession: () => ({ status: "stopped", getCommand: mockGetCommand }),
    });
    const { commands } = await import("../../src/commands/commands.ts");
    await expect(cmd.run(commands, ["get", ...commandArgs])).rejects.toThrow(
      "no running session",
    );
    expect(mockGetCommand).not.toHaveBeenCalled();
  });
});
