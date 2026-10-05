import { expect, it, vi, beforeEach, afterEach, describe } from "vitest";
import ms from "ms";
import { Sandbox } from "./sandbox.js";
import { Command } from "./command.js";
import { Session } from "./session.js";
import { APIClient, type SessionMetaData } from "./api-client/index.js";
import { APIError } from "./api-client/api-error.js";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")("Command", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await Sandbox.create({
      persistent: false,
      snapshotExpiration: ms("1d"),
    });
  });

  afterEach(async () => {
    await sandbox.delete();
  }, 30_000);

  it("supports more than one logs consumer", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const cmd = await sandbox.runCommand({
      cmd: "echo",
      args: ["Hello World!"],
      stdout: process.stdout,
    });

    expect(await cmd.stdout()).toEqual("Hello World!\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Hello World!\n");
  });

  it("does not warn when there is only one logs consumer", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cmd = await sandbox.runCommand({
      cmd: "echo",
      args: ["Hello World!"],
    });

    expect(await cmd.stdout()).toEqual("Hello World!\n");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("Kills a command with a SIGINT", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "sleep",
      args: ["200000"],
      detached: true,
    });

    await cmd.kill("SIGINT");
    const result = await cmd.wait();
    expect(result.exitCode).toBe(130);
  });

  it("Kills a command with a SIGTERM", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "sleep",
      args: ["200000"],
      detached: true,
    });

    await cmd.kill("SIGTERM");

    const result = await cmd.wait();
    expect(result.exitCode).toBe(143);
  });

  it("kills a non-detached (awaited) command with SIGKILL when timeoutMs elapses", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "sleep",
      args: ["60"],
      timeoutMs: 1_000,
    });

    expect(cmd.exitCode).toBe(137);
  });

  it("kills a detached command with SIGKILL when timeoutMs elapses", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "sleep",
      args: ["60"],
      detached: true,
      timeoutMs: 1_000,
    });

    const result = await cmd.wait();
    expect(result.exitCode).toBe(137);
  });

  it("can execute commands with sudo", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "env",
      sudo: true,
      env: {
        FOO: "bar",
      },
    });

    expect(cmd.exitCode).toBe(0);

    const output = await cmd.stdout();
    expect(output).toContain("FOO=bar\n");
    expect(output).toContain("USER=root\n");
    expect(output).toContain("SUDO_USER=ubuntu\n");

    const pathLine = output
      .split("\n")
      .find((line) => line.startsWith("PATH="));
    expect(pathLine).toBeDefined();

    const pathSegments = pathLine!.slice(5).split(":");
    expect(pathSegments).toContain("/usr/local/bin");

    const update = await sandbox.runCommand({
      cmd: "apt-get",
      args: ["update"],
      sudo: true,
    });
    expect(update.exitCode).toBe(0);

    const install = await sandbox.runCommand({
      cmd: "apt-get",
      args: ["install", "-y", "golang-go"],
      sudo: true,
    });
    expect(install.exitCode).toBe(0);

    const which = await sandbox.runCommand("which", ["go"]);
    expect(await which.output()).toContain("/usr/bin/go");
  });

  it("writes to and closes stdin of a detached command", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "cat",
      stdin: true,
      detached: true,
    });

    await cmd.writeStdin("hello ");
    await cmd.writeStdin(new TextEncoder().encode("world\n"));
    await cmd.closeStdin();

    const result = await cmd.wait();
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toBe("hello world\n");
  });

  it("rejects writes to a command started without stdin", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "sleep",
      args: ["30"],
      detached: true,
    });

    await expect(cmd.writeStdin("hello\n")).rejects.toThrow();
    await cmd.kill();
  });
});

describe("Command stdin", () => {
  const cmdData = {
    id: "cmd_123",
    name: "cat",
    args: [],
    cwd: "/",
    sessionId: "sbx_123",
    exitCode: null,
    startedAt: 1,
  };
  let mockFetch: ReturnType<typeof vi.fn>;
  let cmd: Command;

  const ok = () =>
    new Response(JSON.stringify({ command: cmdData }), {
      headers: { "content-type": "application/json" },
    });
  const bodies = () =>
    mockFetch.mock.calls.map(([, init]) => JSON.parse(init.body));

  beforeEach(() => {
    mockFetch = vi.fn(async () => ok());
    cmd = new Command({
      client: new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      }),
      sessionId: "sbx_123",
      cmd: cmdData,
    });
  });

  it("encodes strings as UTF-8", async () => {
    await cmd.writeStdin("héllo");
    expect(bodies()).toEqual([
      { data: Buffer.from("héllo").toString("base64") },
    ]);
  });

  it("skips empty writes", async () => {
    await cmd.writeStdin("");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("splits large writes into ordered chunks", async () => {
    const data = new Uint8Array(512 * 1024 * 2 + 1).map((_, i) => i % 251);
    await cmd.writeStdin(data);

    const sent = bodies().map((b) => Buffer.from(b.data, "base64"));
    expect(sent.map((b) => b.length)).toEqual([512 * 1024, 512 * 1024, 1]);
    expect(Buffer.concat(sent).equals(Buffer.from(data))).toBe(true);
  });

  it("delivers concurrent writes in call order", async () => {
    let release!: () => void;
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(ok()))),
    );

    const first = cmd.writeStdin("a");
    const second = cmd.writeStdin("b");
    const close = cmd.closeStdin();
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second, close]);

    expect(bodies()).toEqual([
      { data: Buffer.from("a").toString("base64") },
      { data: Buffer.from("b").toString("base64") },
      { close: true },
    ]);
  });

  it("requires detached when stdin is attached", async () => {
    const session = new Session({
      client: new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      }),
      routes: [],
      session: { id: "sbx_123" } as SessionMetaData,
    });

    await expect(
      session.runCommand({ cmd: "cat", stdin: true }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps processing writes after one fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "bad_request" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(cmd.writeStdin("a")).rejects.toBeInstanceOf(APIError);
    await cmd.writeStdin("b");
    expect(bodies()[1]).toEqual({ data: Buffer.from("b").toString("base64") });
  });
});
