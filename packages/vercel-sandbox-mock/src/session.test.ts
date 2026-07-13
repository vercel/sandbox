import { describe, expect, test } from "vitest";
import { Sandbox as JustBashSandbox } from "just-bash";
import { Session } from "./session";
import { Snapshot } from "./stubs";
import { command } from "./handlers";
import { handlersToCustomCommands } from "./handlers";

async function createSession(opts?: {
  timeout?: number;
  networkPolicy?: unknown;
  handlers?: ReturnType<typeof command>[];
  cwd?: string;
  ports?: number[];
}) {
  const cwd = opts?.cwd ?? "/vercel/sandbox";
  const handlers = opts?.handlers ?? [];
  const inner = await JustBashSandbox.create({ cwd });
  const customCommands = handlersToCustomCommands(handlers);
  for (const cmd of customCommands) {
    inner.bashEnvInstance.registerCommand(cmd);
  }
  const ports = opts?.ports ?? [];
  const name = "test-session";
  const routes = ports.map((port) => ({
    url: `https://mock-${name}-${port}.sandbox.mock`,
    subdomain: `mock-${name}-${port}`,
    port,
  }));
  return new Session({
    inner,
    timeout: opts?.timeout ?? 300_000,
    cwd,
    routes,
    handlers,
  });
}

describe(Session, () => {
  test("sessionId is a UUID string", async () => {
    const session = await createSession();
    expect(typeof session.sessionId).toBe("string");
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    await session.stop();
  });

  test('status starts as "running"', async () => {
    const session = await createSession();
    expect(session.status).toBe("running");
    await session.stop();
  });

  test("createdAt is a Date", async () => {
    const session = await createSession();
    expect(session.createdAt).toBeInstanceOf(Date);
    await session.stop();
  });

  test("timeout from constructor", async () => {
    const session = await createSession({ timeout: 60_000 });
    expect(session.timeout).toBe(60_000);
    await session.stop();
  });

  test("default getters return expected values", async () => {
    const session = await createSession();
    expect(session.memory).toBe(2048);
    expect(session.vcpus).toBe(1);
    expect(session.region).toBe("mock");
    expect(session.runtime).toBe("node24");
    expect(session.cwd).toBe("/vercel/sandbox");
    expect(session.requestedAt).toBeInstanceOf(Date);
    expect(session.startedAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
    expect(session.interactivePort).toBeUndefined();
    expect(session.sourceSnapshotId).toBeUndefined();
    expect(session.requestedStopAt).toBeUndefined();
    expect(session.stoppedAt).toBeUndefined();
    expect(session.abortedAt).toBeUndefined();
    expect(session.duration).toBeUndefined();
    expect(session.snapshottedAt).toBeUndefined();
    expect(session.activeCpuUsageMs).toBeUndefined();
    expect(session.networkTransfer).toBeUndefined();
    await session.stop();
  });

  test("routes populated from ports", async () => {
    const session = await createSession({ ports: [3000, 8080] });
    expect(session.routes).toHaveLength(2);
    expect(session.routes.map((r) => r.port)).toContain(3000);
    await session.stop();
  });

  test("runCommand string+args form", async () => {
    const session = await createSession();
    const result = await session.runCommand("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toContain("hello");
    await session.stop();
  });

  test("runCommand object form {cmd, args}", async () => {
    const session = await createSession();
    const result = await session.runCommand({ cmd: "echo", args: ["from", "obj"] });
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toContain("from obj");
    await session.stop();
  });

  test("runCommand pipe via shell string", async () => {
    const session = await createSession();
    const result = await session.runCommand("echo hello | grep hello");
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toContain("hello");
    await session.stop();
  });

  test("handler interception works", async () => {
    const handler = command("npm install", { stdout: "mocked\n" });
    const session = await createSession({ handlers: [handler] });
    const result = await session.runCommand("npm", ["install"]);
    expect(await result.stdout()).toBe("mocked\n");
    await session.stop();
  });

  test("handler can use exec to delegate to just-bash", async () => {
    const handler = command("wrapper", async (args, ctx) => {
      if (!ctx.exec) {
        return { stderr: "exec not available", exitCode: 1 };
      }
      // Delegate to the wrapped command (e.g., "wrapper echo hello" -> "echo hello")
      return ctx.exec(args[0], args.slice(1));
    });
    const session = await createSession({ handlers: [handler] });

    // Write a file and use wrapper to cat it
    await session.writeFiles([
      { path: "/tmp/test.txt", content: Buffer.from("delegated content") },
    ]);
    const result = await session.runCommand("wrapper", ["cat", "/tmp/test.txt"]);

    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toBe("delegated content");
    await session.stop();
  });

  test("handler exec delegates to just-bash builtins", async () => {
    const handler = command("runuser", async (args, ctx) => {
      if (!ctx.exec) {
        return { stderr: "exec not available", exitCode: 1 };
      }
      // Parse runuser args: runuser -u <user> -- <cmd> [args...]
      // Find -- separator and execute command after it
      const dashDashIndex = args.indexOf("--");
      if (dashDashIndex === -1) {
        return { stderr: "runuser: missing -- separator", exitCode: 1 };
      }
      const cmdArgs = args.slice(dashDashIndex + 1);
      if (cmdArgs.length === 0) {
        return { stderr: "runuser: no command specified", exitCode: 1 };
      }
      return ctx.exec(cmdArgs[0], cmdArgs.slice(1));
    });
    const session = await createSession({ handlers: [handler] });

    // Write a file and use runuser to cat it (simulating runAsSessionUnixUser pattern)
    await session.writeFiles([{ path: "/home/user/data.txt", content: Buffer.from("user data") }]);
    const result = await session.runCommand("runuser", [
      "-u",
      "testuser",
      "--",
      "cat",
      "/home/user/data.txt",
    ]);

    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toBe("user data");
    await session.stop();
  });

  test("detached runCommand", async () => {
    const session = await createSession();
    const cmd = await session.runCommand({ cmd: "echo", args: ["detached"], detached: true });
    const finished = await cmd.wait();
    expect(finished.exitCode).toBe(0);
    expect(await finished.stdout()).toContain("detached");
    await session.stop();
  });

  test("getCommand returns previously run command", async () => {
    const session = await createSession();
    const result = await session.runCommand("echo", ["tracked"]);
    const retrieved = await session.getCommand(result.cmdId);
    expect(retrieved.cmdId).toBe(result.cmdId);
    await session.stop();
  });

  test("getCommand throws for unknown cmdId", async () => {
    const session = await createSession();
    await expect(session.getCommand("nonexistent")).rejects.toThrow();
    await session.stop();
  });

  test("writeFiles + readFile roundtrip", async () => {
    const session = await createSession();
    await session.writeFiles([{ path: "/tmp/test.txt", content: Buffer.from("hello world") }]);
    const stream = await session.readFile({ path: "/tmp/test.txt" });
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    expect(Buffer.concat(chunks).toString("utf-8")).toBe("hello world");
    await session.stop();
  });

  test("readFile returns null for missing file", async () => {
    const session = await createSession();
    const result = await session.readFile({ path: "/no/such/file.txt" });
    expect(result).toBeNull();
    await session.stop();
  });

  test("readFileToBuffer returns Buffer", async () => {
    const session = await createSession();
    await session.writeFiles([{ path: "/tmp/buf.txt", content: Buffer.from("buf test") }]);
    const buf = await session.readFileToBuffer({ path: "/tmp/buf.txt" });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf!.toString("utf-8")).toBe("buf test");
    await session.stop();
  });

  test("mkDir creates directory", async () => {
    const session = await createSession();
    await session.mkDir("/tmp/newdir");
    const result = await session.runCommand("ls", ["/tmp/newdir"]);
    expect(result.exitCode).toBe(0);
    await session.stop();
  });

  test("domain(port) returns URL when port configured", async () => {
    const session = await createSession({ ports: [3000] });
    const url = session.domain(3000);
    expect(url).toContain("3000");
    expect(url).toMatch(/^https:\/\//);
    await session.stop();
  });

  test("domain() throws for unconfigured port", async () => {
    const session = await createSession();
    expect(() => session.domain(9999)).toThrow();
    await session.stop();
  });

  test('stop() changes status to "stopped"', async () => {
    const session = await createSession();
    const result = await session.stop();
    expect(session.status).toBe("stopped");
    expect(result.session.status).toBe("stopped");
    expect(session.stoppedAt).toBeInstanceOf(Date);
    expect(typeof session.duration).toBe("number");
    expect(session.activeCpuUsageMs).toBe(0);
    expect(session.networkTransfer).toEqual({ ingress: 0, egress: 0 });
  });

  test("extendTimeout() increases timeout", async () => {
    const session = await createSession({ timeout: 60_000 });
    await session.extendTimeout(30_000);
    expect(session.timeout).toBe(90_000);
    await session.stop();
  });

  test("update() modifies network policy", async () => {
    const session = await createSession();
    await session.update({ networkPolicy: "deny-all" });
    expect(session.networkPolicy).toBe("deny-all");
    await session.stop();
  });

  test("snapshot() returns a Snapshot", async () => {
    const session = await createSession();
    const snap = await session.snapshot();
    expect(snap).toBeInstanceOf(Snapshot);
    expect(snap.sourceSessionId).toBe(session.sessionId);
    expect(session.snapshottedAt).toBeInstanceOf(Date);
    await session.stop();
  });
});
