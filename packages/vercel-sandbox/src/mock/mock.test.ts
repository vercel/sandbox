import { afterEach, it, describe, expect } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { PassThrough } from "stream";
import { consumeReadable } from "../utils/consume-readable.js";
import { MockSandbox } from "./sandbox.js";
import { MockCommand, MockCommandFinished } from "./command.js";
import { MockSnapshot } from "./snapshot.js";
import { command } from "./handlers.js";
import { setupSandbox } from "./sandbox.js";

describe(MockSandbox, () => {
  it("writeFiles and readFileToBuffer roundtrip", async () => {
    const sandbox = await MockSandbox.create();
    await sandbox.writeFiles([
      { path: "test.txt", content: Buffer.from("hello") },
    ]);
    const buf = await sandbox.readFileToBuffer({ path: "test.txt" });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf!.toString()).toBe("hello");
  });

  it("readFileToBuffer returns null for missing file", async () => {
    const sandbox = await MockSandbox.create();
    await expect(
      sandbox.readFileToBuffer({ path: "nonexistent.txt" }),
    ).resolves.toBeNull();
  });

  it("readFile returns readable stream", async () => {
    const sandbox = await MockSandbox.create();
    await sandbox.writeFiles([
      { path: "hello.txt", content: Buffer.from("hello") },
    ]);
    const stream = await sandbox.readFile({ path: "hello.txt" });
    expect(stream).not.toBeNull();
    const buf = await consumeReadable(stream!);
    expect(buf.toString()).toBe("hello");
  });

  it("downloadFile writes to local filesystem", async () => {
    const sandbox = await MockSandbox.create();
    await sandbox.writeFiles([
      { path: "download.txt", content: Buffer.from("data") },
    ]);

    const tmpDir = await mkdtemp(join(tmpdir(), "mock-sandbox-test-"));
    try {
      const result = await sandbox.downloadFile(
        { path: "download.txt" },
        { path: "out.txt", cwd: tmpDir },
      );
      expect(result).toBe(resolve(tmpDir, "out.txt"));
      expect(await readFile(result!, "utf-8")).toBe("data");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("runCommand executes via just-bash", async () => {
    const sandbox = await MockSandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    await expect(result.stdout()).resolves.toBe("hello\n");
  });

  it("runCommand with params object", async () => {
    const sandbox = await MockSandbox.create();
    const result = await sandbox.runCommand({ cmd: "echo", args: ["hello"] });
    expect(result.exitCode).toBe(0);
    await expect(result.stdout()).resolves.toBe("hello\n");
  });

  it("runCommand with detached returns Command", async () => {
    const sandbox = await MockSandbox.create();
    const result = await sandbox.runCommand({
      cmd: "echo",
      args: ["bg"],
      detached: true,
    });
    expect(result).toBeInstanceOf(MockCommand);
    await expect(result.stdout()).resolves.toBe("bg\n");
  });

  it("runCommand pipes to stdout/stderr writables", async () => {
    const sandbox = await MockSandbox.create();
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on("data", (c) => chunks.push(c));

    await sandbox.runCommand({ cmd: "echo", args: ["piped"], stdout: out });
    expect(Buffer.concat(chunks).toString()).toBe("piped\n");
  });

  it("runCommand handles filesystem commands", async () => {
    const sandbox = await MockSandbox.create({
      files: { "greeting.txt": "hi there" },
    });
    const result = await sandbox.runCommand("cat", [
      "/vercel/sandbox/greeting.txt",
    ]);
    expect(result.exitCode).toBe(0);
    await expect(result.stdout()).resolves.toBe("hi there");
  });

  it("files written via writeFiles are visible to bash commands", async () => {
    const sandbox = await MockSandbox.create();
    await sandbox.writeFiles([
      { path: "data.txt", content: Buffer.from("from-api") },
    ]);
    const result = await sandbox.runCommand("cat", [
      "/vercel/sandbox/data.txt",
    ]);
    await expect(result.stdout()).resolves.toBe("from-api");
  });

  it("files written via bash commands are visible to readFileToBuffer", async () => {
    const sandbox = await MockSandbox.create();
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", "echo -n from-bash > /vercel/sandbox/output.txt"],
    });
    const buf = await sandbox.readFileToBuffer({ path: "output.txt" });
    expect(buf!.toString()).toBe("from-bash");
  });

  it("mkDir creates directories in the virtual filesystem", async () => {
    const sandbox = await MockSandbox.create();
    await sandbox.mkDir("/vercel/sandbox/deep/nested/dir");
    const result = await sandbox.runCommand("ls", [
      "/vercel/sandbox/deep/nested",
    ]);
    await expect(result.stdout()).resolves.toContain("dir");
  });

  it("domain returns URL for configured port", async () => {
    const sandbox = await MockSandbox.create({ ports: [3000] });
    expect(sandbox.domain(3000)).toBe("https://mock-port-3000.vercel.run");
  });

  it("stop transitions status", async () => {
    const sandbox = await MockSandbox.create();
    expect(sandbox.status).toBe("running");
    const result = await sandbox.stop();
    expect(result.status).toBe("stopped");
    expect(sandbox.status).toBe("stopped");
  });

  it("extendTimeout increases timeout", async () => {
    const sandbox = await MockSandbox.create({ timeout: 10_000 });
    await sandbox.extendTimeout(5_000);
    expect(sandbox.timeout).toBe(15_000);
  });

  it("snapshot returns MockSnapshot", async () => {
    const sandbox = await MockSandbox.create({ sandboxId: "sbx_test" });
    const snap = await sandbox.snapshot();
    expect(snap).toBeInstanceOf(MockSnapshot);
    expect(snap.sourceSandboxId).toBe("sbx_test");
  });

  it("updateNetworkPolicy updates policy", async () => {
    const sandbox = await MockSandbox.create();
    const result = await sandbox.updateNetworkPolicy("allow-all");
    expect(result).toBe("allow-all");
    expect(sandbox.networkPolicy).toBe("allow-all");
  });

  it("create returns AsyncDisposable", async () => {
    const sandbox = await MockSandbox.create();
    expect(typeof sandbox[Symbol.asyncDispose]).toBe("function");
  });

  it("pre-seeded string files are readable", async () => {
    const sandbox = await MockSandbox.create({
      files: { "hello.txt": "seeded-string" },
    });
    const buf = await sandbox.readFileToBuffer({ path: "hello.txt" });
    expect(buf!.toString()).toBe("seeded-string");
  });

  it("exposes fs for direct filesystem access", async () => {
    const sandbox = await MockSandbox.create();
    await sandbox.fs.writeFile("/vercel/sandbox/direct.txt", "via-fs");
    const content = await sandbox.fs.readFile("/vercel/sandbox/direct.txt");
    expect(content).toBe("via-fs");
  });
});

describe(MockCommand, () => {
  it("wait finalizes exitCode", async () => {
    const cmd = new MockCommand();
    expect(cmd.exitCode).toBeNull();
    const finished = await cmd.wait();
    expect(finished).toBeInstanceOf(MockCommandFinished);
    expect(finished.exitCode).toBe(0);
  });

  it("logs yields configured entries", async () => {
    const cmd = new MockCommand({
      logs: [
        { stream: "stdout", data: "line1" },
        { stream: "stderr", data: "err1" },
      ],
    });
    const entries: unknown[] = [];
    for await (const entry of cmd.logs()) entries.push(entry);
    expect(entries).toEqual([
      { stream: "stdout", data: "line1" },
      { stream: "stderr", data: "err1" },
    ]);
  });

  it("output('both') concatenates stdout and stderr", async () => {
    const cmd = new MockCommand({ stdout: "out", stderr: "err" });
    await expect(cmd.output("both")).resolves.toBe("outerr");
  });
});

describe(setupSandbox, () => {
  const sandboxMock = setupSandbox(
    command("npm install", { stdout: "default\n" }),
  );

  afterEach(() => sandboxMock.resetHandlers());

  it("use() overrides default handlers", async () => {
    sandboxMock.use(command("npm install", { stdout: "override\n" }));

    const sandbox = await MockSandbox.create();
    const result = await sandbox.runCommand("npm", ["install"]);
    await expect(result.stdout()).resolves.toBe("override\n");
  });

  it("use() overrides per-create handlers", async () => {
    sandboxMock.use(command("npm install", { stdout: "runtime\n" }));

    const sandbox = await MockSandbox.create({
      handlers: [command("npm install", { stdout: "per-create\n" })],
    });
    const result = await sandbox.runCommand("npm", ["install"]);
    await expect(result.stdout()).resolves.toBe("runtime\n");
  });

  it("per-create handlers override default handlers", async () => {
    const sandbox = await MockSandbox.create({
      handlers: [command("npm install", { stdout: "per-create\n" })],
    });
    const result = await sandbox.runCommand("npm", ["install"]);
    await expect(result.stdout()).resolves.toBe("per-create\n");
  });

  it("resetHandlers() clears use() overrides but keeps defaults", async () => {
    sandboxMock.use(command("npm install", { stdout: "override\n" }));
    sandboxMock.resetHandlers();

    const sandbox = await MockSandbox.create();
    const result = await sandbox.runCommand("npm", ["install"]);
    await expect(result.stdout()).resolves.toBe("default\n");
  });

  it("unmatched command falls through to just-bash", async () => {
    const sandbox = await MockSandbox.create();
    const result = await sandbox.runCommand("echo", ["fallthrough"]);
    await expect(result.stdout()).resolves.toBe("fallthrough\n");
  });

  it("matched handler takes priority over just-bash", async () => {
    sandboxMock.use(command("echo", { stdout: "from-handler\n" }));

    const sandbox = await MockSandbox.create();
    const result = await sandbox.runCommand("echo", ["anything"]);
    await expect(result.stdout()).resolves.toBe("from-handler\n");
  });
});

describe(command, () => {
  it("string pattern prefix matches", () => {
    const handler = command("npm install", { stdout: "ok\n" });
    expect(handler.matches("npm", ["install"])).toBe(true);
    expect(handler.matches("npm", ["install", "--save"])).toBe(true);
    expect(handler.matches("npm", ["test"])).toBe(false);
  });

  it("regex pattern matches", () => {
    const handler = command(/^npm\s+install/, { stdout: "ok\n" });
    expect(handler.matches("npm", ["install"])).toBe(true);
    expect(handler.matches("npm", ["test"])).toBe(false);
  });

  it("dynamic response function", async () => {
    const handler = command("echo", (args) => ({ stdout: `${args.join(" ")}\n` }));
    const result = await handler.resolve("echo", ["hello", "world"]);
    expect(result).toEqual({ stdout: "hello world\n" });
  });

  it("handler with detached returns Command with null exitCode", async () => {
    const sandbox = await MockSandbox.create({
      handlers: [command("sleep", { stdout: "" })],
    });
    const result = await sandbox.runCommand({
      cmd: "sleep",
      args: ["10"],
      detached: true,
    });
    expect(result.exitCode).toBeNull();
  });

  it("empty string pattern throws", () => {
    expect(() => command("", { stdout: "x" })).toThrow(
      "Command pattern must not be empty",
    );
  });
});

describe(MockSnapshot, () => {
  it("delete transitions status to deleted", async () => {
    const snap = new MockSnapshot();
    await snap.delete();
    expect(snap.status).toBe("deleted");
  });

  it("static get returns configured snapshot", async () => {
    const snap = await MockSnapshot.get({
      snapshot: { snapshotId: "snap_test" },
    });
    expect(snap.snapshotId).toBe("snap_test");
  });

  it("static list returns configured snapshots", async () => {
    const result = await MockSnapshot.list({
      snapshots: [{ snapshotId: "a" }, { snapshotId: "b" }],
    });
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots[0]!.snapshotId).toBe("a");
  });
});
