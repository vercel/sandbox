import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const {
  mockGet,
  mockRunCommand,
  mockGetCommand,
  mockWriteStdin,
  mockCloseStdin,
  mockOutput,
  mockDomain,
  mockCreateUser,
  mockAsUser,
  mockUserRunCommand,
  mockCreateGroup,
  mockAddUserToGroup,
  mockRemoveUserFromGroup,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRunCommand: vi.fn(),
  mockGetCommand: vi.fn(),
  mockWriteStdin: vi.fn(),
  mockCloseStdin: vi.fn(),
  mockOutput: vi.fn(),
  mockDomain: vi.fn(),
  mockCreateUser: vi.fn(),
  mockAsUser: vi.fn(),
  mockUserRunCommand: vi.fn(),
  mockCreateGroup: vi.fn(),
  mockAddUserToGroup: vi.fn(),
  mockRemoveUserFromGroup: vi.fn(),
}));

vi.mock("../../src/client", () => ({ sandboxClient: { get: mockGet } }));
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

const scopeFlags = ["--scope=team", "--project=proj"];
const commandArgs = ["my-sandbox", "cmd_1", ...scopeFlags];

describe("SDK parity CLI commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_AUTH_TOKEN", "tok");
    mockRunCommand.mockResolvedValue({ cmdId: "cmd_1", exitCode: 0 });
    mockOutput.mockResolvedValue("error output\n");
    mockGetCommand.mockResolvedValue({
      writeStdin: mockWriteStdin,
      closeStdin: mockCloseStdin,
      output: mockOutput,
    });
    mockCreateUser.mockResolvedValue({
      username: "alice",
      homeDir: "/home/alice",
    });
    mockUserRunCommand.mockResolvedValue({ cmdId: "cmd_user", exitCode: 0 });
    mockAsUser.mockReturnValue({ runCommand: mockUserRunCommand });
    mockCreateGroup.mockResolvedValue({
      groupname: "devs",
      sharedDir: "/shared/devs",
    });
    mockDomain.mockReturnValue("https://example.vercel.run");
    mockGet.mockResolvedValue({
      runCommand: mockRunCommand,
      currentSession: () => ({ status: "running", getCommand: mockGetCommand }),
      domain: mockDomain,
      createUser: mockCreateUser,
      asUser: mockAsUser,
      createGroup: mockCreateGroup,
      addUserToGroup: mockAddUserToGroup,
      removeUserFromGroup: mockRemoveUserFromGroup,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("detached exec keeps stdin open and foreground exec forwards a local stream", async () => {
    const { exec } = await import("../../src/commands/exec.ts");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await exec.handler({
      sandbox: "my-sandbox",
      command: "cat",
      args: [],
      scope: { token: "tok", team: "team", project: "proj" },
      asSudo: false,
      interactive: false,
      detached: true,
      stdin: true,
      skipExtendingTimeout: false,
      tty: false,
      cwd: undefined,
      envVars: {},
      timeout: undefined,
    });
    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({ cmd: "cat", detached: true, stdin: true }),
    );
    expect(output).toHaveBeenCalledWith("cmd_1\n");
    const input = Readable.from(["hello\n"]);
    vi.spyOn(process, "stdin", "get").mockReturnValue(
      input as typeof process.stdin,
    );
    await exec.handler({
      sandbox: "my-sandbox",
      command: "cat",
      args: [],
      scope: { token: "tok", team: "team", project: "proj" },
      asSudo: false,
      interactive: false,
      detached: false,
      stdin: true,
      skipExtendingTimeout: false,
      tty: false,
      cwd: undefined,
      envVars: {},
      timeout: undefined,
    });
    expect(mockRunCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ cmd: "cat", stdin: input }),
    );
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test("writes piped bytes in order, closes stdin, and selects stderr", async () => {
    const { commands } = await import("../../src/commands/commands.ts");
    const input = Readable.from([Buffer.from("one"), Buffer.from("two")]);
    vi.spyOn(process, "stdin", "get").mockReturnValue(
      input as typeof process.stdin,
    );
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await cmd.run(commands, ["write", ...commandArgs]);
    await cmd.run(commands, ["close-stdin", ...commandArgs]);
    await cmd.run(commands, ["output", ...commandArgs, "--stream=stderr"]);
    expect(
      mockWriteStdin.mock.calls.map(([data]) => Buffer.from(data).toString()),
    ).toEqual(["one", "two"]);
    expect(mockCloseStdin).toHaveBeenCalledOnce();
    expect(mockOutput).toHaveBeenCalledWith("stderr");
    expect(output).toHaveBeenCalledWith("error output\n");
    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({ resume: false }),
    );
  });

  test("resolves a port without resuming and refuses a stopped session", async () => {
    const { domain } = await import("../../src/commands/domain.ts");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await cmd.run(domain, ["my-sandbox", "3000", ...scopeFlags]);
    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({ resume: false }),
    );
    expect(mockDomain).toHaveBeenCalledWith(3000);
    expect(output).toHaveBeenCalledWith("https://example.vercel.run\n");
    mockGet.mockResolvedValue({
      currentSession: () => ({ status: "stopped" }),
      domain: mockDomain,
    });
    await expect(
      cmd.run(domain, ["my-sandbox", "3000", ...scopeFlags]),
    ).rejects.toThrow("no running session");
  });

  test("creates a user and executes through the SDK user handle", async () => {
    const { users } = await import("../../src/commands/users.ts");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await cmd.run(users, ["create", "my-sandbox", "alice", ...scopeFlags]);
    await cmd.run(users, [
      "exec",
      "my-sandbox",
      "alice",
      "whoami",
      ...scopeFlags,
    ]);
    expect(mockCreateUser).toHaveBeenCalledWith("alice");
    expect(mockAsUser).toHaveBeenCalledWith("alice");
    expect(mockUserRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({ cmd: "whoami" }),
    );
    expect(output).toHaveBeenCalledWith("alice\t/home/alice\n");
    const input = Readable.from(["hello\n"]);
    vi.spyOn(process, "stdin", "get").mockReturnValue(
      input as typeof process.stdin,
    );
    await cmd.run(users, [
      "exec",
      "my-sandbox",
      "alice",
      "--stdin",
      "cat",
      ...scopeFlags,
    ]);
    expect(mockUserRunCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ cmd: "cat", stdin: input }),
    );
  });

  test("creates a group and changes membership through SDK methods", async () => {
    const { groups } = await import("../../src/commands/groups.ts");
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await cmd.run(groups, ["create", "my-sandbox", "devs", ...scopeFlags]);
    await cmd.run(groups, [
      "add-user",
      "my-sandbox",
      "devs",
      "alice",
      ...scopeFlags,
    ]);
    await cmd.run(groups, [
      "remove-user",
      "my-sandbox",
      "devs",
      "alice",
      ...scopeFlags,
    ]);
    expect(mockCreateGroup).toHaveBeenCalledWith("devs");
    expect(mockAddUserToGroup).toHaveBeenCalledWith("alice", "devs");
    expect(mockRemoveUserFromGroup).toHaveBeenCalledWith("alice", "devs");
    expect(output).toHaveBeenCalledWith("devs\t/shared/devs\n");
  });
});
