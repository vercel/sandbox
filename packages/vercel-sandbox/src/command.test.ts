import { expect, it, vi, beforeEach, afterEach, describe } from "vitest";
import ms from "ms";
import { PassThrough } from "stream";
import { Sandbox } from "./sandbox.js";
import { Command, CommandFinished } from "./command.js";
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
  let server: ReturnType<typeof createStdinServer>;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const failure = (status: number) =>
    json({ error: { code: "failed" } }, status);

  /**
   * Stands in for the API: applies offsets the way the real one does, and
   * omits `bytesWritten` like a sandbox that predates offsets when `legacy`.
   */
  function createStdinServer(options: { legacy?: boolean } = {}) {
    const state = { data: Buffer.alloc(0), closed: false };
    const handler = async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const chunk = body.data
        ? Buffer.from(body.data, "base64")
        : Buffer.alloc(0);
      if (state.closed && (chunk.length > 0 || body.close)) {
        return failure(400);
      }
      if (options.legacy || body.offset === undefined) {
        state.data = Buffer.concat([state.data, chunk]);
      } else if (body.offset > state.data.length) {
        return failure(409);
      } else {
        const skip = state.data.length - body.offset;
        state.data = Buffer.concat([state.data, chunk.subarray(skip)]);
      }
      if (body.close) state.closed = true;
      return json({
        command: cmdData,
        ...(!options.legacy && { bytesWritten: state.data.length }),
      });
    };
    return Object.assign(state, { handler });
  }

  const bodies = () =>
    mockFetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  const dataBodies = () =>
    bodies().filter((b) => b.data !== undefined || b.close);
  const b64 = (text: string) => Buffer.from(text).toString("base64");

  function createCommand() {
    return new Command({
      client: new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      }),
      sessionId: "sbx_123",
      cmd: cmdData,
    });
  }

  async function settle<T>(promise: Promise<T>) {
    const result = promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.runAllTimersAsync();
    return result;
  }

  beforeEach(() => {
    server = createStdinServer();
    mockFetch = vi.fn(server.handler);
    cmd = createCommand();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("encodes strings as UTF-8", async () => {
    await cmd.writeStdin("héllo");
    expect(dataBodies()).toEqual([{ data: b64("héllo"), offset: 0 }]);
  });

  it("skips empty writes", async () => {
    await cmd.writeStdin("");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("splits large writes into ordered chunks", async () => {
    const data = new Uint8Array(512 * 1024 * 2 + 1).map((_, i) => i % 251);
    await cmd.writeStdin(data);

    const sent = dataBodies().map((b) => Buffer.from(b.data, "base64"));
    expect(sent.map((b) => b.length)).toEqual([512 * 1024, 512 * 1024, 1]);
    expect(dataBodies().map((b) => b.offset)).toEqual([
      0,
      512 * 1024,
      512 * 1024 * 2,
    ]);
    expect(Buffer.concat(sent).equals(Buffer.from(data))).toBe(true);
  });

  it("delivers concurrent writes in call order", async () => {
    let release!: () => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = async () =>
            resolve(await server.handler(null, { body: "{}" }));
        }),
    );

    const first = cmd.writeStdin("a");
    const second = cmd.writeStdin("b");
    const close = cmd.closeStdin();
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second, close]);

    expect(dataBodies()).toEqual([
      { data: b64("a"), offset: 0 },
      { data: b64("b"), offset: 1 },
      { close: true, offset: 2 },
    ]);
  });

  it("continues from the position the API reports", async () => {
    server.data = Buffer.from("earlier");

    await cmd.writeStdin("a");
    await cmd.closeStdin();

    expect(dataBodies()).toEqual([
      { data: b64("a"), offset: 7 },
      { close: true, offset: 8 },
    ]);
    expect(server.data.toString()).toBe("earliera");
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

  it("disables workflow step retries so bytes are not resent", () => {
    for (const method of [
      Command.prototype.writeStdin,
      Command.prototype.closeStdin,
    ]) {
      expect((method as { maxRetries?: number }).maxRetries).toBe(0);
    }
  });

  describe("when a request is lost", () => {
    beforeEach(() => vi.useFakeTimers());

    it("resends without writing the bytes twice", async () => {
      await cmd.writeStdin("a");
      mockFetch.mockImplementationOnce(async (url, init) => {
        await server.handler(url, init);
        throw new TypeError("fetch failed");
      });

      const result = await settle(cmd.writeStdin("bc"));
      await cmd.writeStdin("d");

      expect(result).not.toHaveProperty("error");
      expect(server.data.toString()).toBe("abcd");
    });

    it("resends a close and resolves when the process already exited", async () => {
      await cmd.writeStdin("a");
      mockFetch
        .mockImplementationOnce(async (url, init) => {
          await server.handler(url, init);
          throw new TypeError("fetch failed");
        })
        .mockResolvedValueOnce(failure(404));

      const result = await settle(cmd.closeStdin());

      expect(result).not.toHaveProperty("error");
      expect(server.closed).toBe(true);
    });

    it("rejects later writes once retries run out", async () => {
      await cmd.writeStdin("a");
      mockFetch.mockImplementation(async () => failure(503));

      const result = await settle(cmd.writeStdin("b"));
      mockFetch.mockClear();

      expect(result).toHaveProperty("error");
      await expect(cmd.writeStdin("c")).rejects.toThrow("unknown state");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it("rejects later writes after a chunked write fails partway", async () => {
    await cmd.writeStdin("");
    mockFetch
      .mockImplementationOnce(server.handler)
      .mockImplementationOnce(server.handler)
      .mockResolvedValueOnce(failure(500));

    await expect(
      cmd.writeStdin(new Uint8Array(512 * 1024 + 1)),
    ).rejects.toBeInstanceOf(APIError);
    await expect(cmd.writeStdin("next")).rejects.toThrow(
      "unknown state after an earlier write failed",
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);

    await cmd.closeStdin();
    expect(bodies().at(-1)).toEqual({ close: true, offset: 512 * 1024 });
  });

  it("fails without retrying when the API rejects the offset", async () => {
    server.data = Buffer.from("x");
    await cmd.writeStdin("a");
    server.data = Buffer.alloc(0);
    mockFetch.mockClear();

    await expect(cmd.writeStdin("b")).rejects.toMatchObject({
      response: { status: 409 },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  describe("on a sandbox without stdin offsets", () => {
    beforeEach(() => {
      server = createStdinServer({ legacy: true });
      mockFetch = vi.fn(server.handler);
      cmd = createCommand();
    });

    it("writes without an offset", async () => {
      await cmd.writeStdin("a");
      await cmd.writeStdin("b");
      await cmd.closeStdin();

      expect(dataBodies()).toEqual([
        { data: b64("a") },
        { data: b64("b") },
        { close: true },
      ]);
    });

    it("does not resend, and rejects later writes after a network error", async () => {
      await cmd.writeStdin("a");
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(cmd.writeStdin("b")).rejects.toThrow("fetch failed");
      await expect(cmd.writeStdin("c")).rejects.toThrow("unknown state");
      expect(server.data.toString()).toBe("a");
    });
  });

  it("aborts a write that is still waiting for its turn", async () => {
    let release!: () => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = async () =>
            resolve(await server.handler(null, { body: "{}" }));
        }),
    );

    const first = cmd.writeStdin("a");
    const controller = new AbortController();
    const second = cmd.writeStdin("b", { abortSignal: controller.signal });
    const third = cmd.writeStdin("c");
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(second).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, third]);
    expect(dataBodies()).toEqual([
      { data: b64("a"), offset: 0 },
      { data: b64("c"), offset: 1 },
    ]);
  });

  it("rejects stdin calls on a finished command", async () => {
    const finished = new CommandFinished({
      client: new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      }),
      sessionId: "sbx_123",
      cmd: { ...cmdData, exitCode: 0 },
      exitCode: 0,
    });

    await expect(finished.writeStdin("a")).rejects.toThrow("already finished");
    await expect(finished.closeStdin()).rejects.toThrow("already finished");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps processing writes after one fails", async () => {
    await cmd.writeStdin("a");
    mockFetch.mockResolvedValueOnce(failure(400));

    await expect(cmd.writeStdin("b")).rejects.toBeInstanceOf(APIError);
    await cmd.writeStdin("c");
    expect(dataBodies().at(-1)).toEqual({ data: b64("c"), offset: 1 });
  });

  describe("with a Readable", () => {
    const finishedData = { ...cmdData, exitCode: 0 };
    let runBodies: Record<string, unknown>[];
    let finishCommand: () => void;

    function createSession() {
      return new Session({
        client: new APIClient({
          teamId: "team_123",
          token: "1234",
          fetch: mockFetch,
        }),
        routes: [],
        session: { id: "sbx_123" } as SessionMetaData,
      });
    }

    beforeEach(() => {
      runBodies = [];
      let finished!: () => void;
      const commandFinished = new Promise<void>((resolve) => (finished = resolve));
      finishCommand = finished;
      server.closed = false;
      mockFetch = vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/stdin")) {
          const response = await server.handler(url, init);
          if (server.closed) finishCommand();
          return response;
        }
        if (path.endsWith("/cmd")) {
          const body = JSON.parse(init.body as string);
          runBodies.push(body);
          if (!body.wait) return json({ command: cmdData });
          const encoder = new TextEncoder();
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(
                  encoder.encode(`${JSON.stringify({ command: cmdData })}\n`),
                );
                await commandFinished;
                controller.enqueue(
                  encoder.encode(
                    `${JSON.stringify({ command: finishedData })}\n`,
                  ),
                );
                controller.close();
              },
            }),
            { headers: { "content-type": "application/x-ndjson" } },
          );
        }
        await commandFinished;
        return json({ command: finishedData });
      });
    });

    it("pipes the stream and waits for the command", async () => {
      const stream = new PassThrough({ autoDestroy: false });
      stream.end("hello\n");

      const result = await createSession().runCommand({
        cmd: "cat",
        stdin: stream,
      });

      expect(result.exitCode).toBe(0);
      expect(runBodies[0]).toMatchObject({ attachStdin: true, wait: true });
      expect(server.data.toString()).toBe("hello\n");
      expect(server.closed).toBe(true);
      expect(stream.destroyed).toBe(false);
    });

    it("pipes the stream to a detached command", async () => {
      const stream = new PassThrough();

      const command = await createSession().runCommand({
        cmd: "cat",
        stdin: stream,
        detached: true,
      });
      stream.end("hi");
      const result = await command.wait();

      expect(result.exitCode).toBe(0);
      expect(runBodies[0]).toMatchObject({ attachStdin: true });
      expect(server.data.toString()).toBe("hi");
    });

    it("rejects wait when writing the stream fails", async () => {
      const stream = new PassThrough();
      const command = await createSession().runCommand({
        cmd: "cat",
        stdin: stream,
        detached: true,
      });
      mockFetch.mockImplementation(async (url: string) =>
        new URL(url).pathname.endsWith("/stdin")
          ? failure(500)
          : new Promise<Response>(() => {}),
      );

      stream.write("a");

      await expect(command.wait()).rejects.toBeInstanceOf(APIError);
    });
  });
});
