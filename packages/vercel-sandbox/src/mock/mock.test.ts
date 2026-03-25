import { it, describe, expect } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { consumeReadable } from "../utils/consume-readable.js";
import { MockSandbox } from "./sandbox.js";
import { MockCommand, MockCommandFinished } from "./command.js";
import { MockSnapshot } from "./snapshot.js";

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

  it("readFile returns null for missing file", async () => {
    const sandbox = await MockSandbox.create();
    await expect(
      sandbox.readFile({ path: "missing.txt" }),
    ).resolves.toBeNull();
  });

  it("mkDir resolves without error", async () => {
    const sandbox = await MockSandbox.create();
    await expect(sandbox.mkDir("/test/dir")).resolves.toBeUndefined();
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

  it("downloadFile returns null for missing file", async () => {
    const sandbox = await MockSandbox.create();
    const tmpDir = await mkdtemp(join(tmpdir(), "mock-sandbox-test-"));
    try {
      await expect(
        sandbox.downloadFile(
          { path: "missing.txt" },
          { path: "out.txt", cwd: tmpDir },
        ),
      ).resolves.toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("runCommand with string args returns CommandFinished", async () => {
    const sandbox = await MockSandbox.create({
      commands: { echo: { exitCode: 0, stdout: "hi" } },
    });
    const result = await sandbox.runCommand("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    await expect(result.stdout()).resolves.toBe("hi");
  });

  it("runCommand with detached returns Command", async () => {
    const sandbox = await MockSandbox.create({
      commands: { sleep: { exitCode: null } },
    });
    const result = await sandbox.runCommand({
      cmd: "sleep",
      args: ["1"],
      detached: true,
    });
    expect(result.exitCode).toBeNull();
  });

  it("runCommand with params object returns CommandFinished", async () => {
    const sandbox = await MockSandbox.create({
      commands: { echo: { exitCode: 0, stdout: "hello" } },
    });
    const result = await sandbox.runCommand({ cmd: "echo", args: ["hello"] });
    expect(result.exitCode).toBe(0);
    await expect(result.stdout()).resolves.toBe("hello");
  });

  it("domain returns URL for configured port", async () => {
    const sandbox = await MockSandbox.create({ ports: [3000] });
    expect(sandbox.domain(3000)).toBe("https://mock-port-3000.vercel.run");
  });

  it("domain throws for unconfigured port", async () => {
    const sandbox = await MockSandbox.create({ ports: [3000] });
    expect(() => sandbox.domain(9999)).toThrow("No route for port 9999");
  });

  it("stop transitions status to stopped", async () => {
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

  it("snapshot returns MockSnapshot with sourceSandboxId", async () => {
    const sandbox = await MockSandbox.create({ sandboxId: "sbx_test" });
    const snap = await sandbox.snapshot();
    expect(snap).toBeInstanceOf(MockSnapshot);
    expect(snap.sourceSandboxId).toBe("sbx_test");
  });

  it("updateNetworkPolicy updates policy", async () => {
    const sandbox = await MockSandbox.create();
    expect(sandbox.networkPolicy).toBeUndefined();
    const result = await sandbox.updateNetworkPolicy("allow-all");
    expect(result).toBe("allow-all");
    expect(sandbox.networkPolicy).toBe("allow-all");
  });

  it("create returns AsyncDisposable", async () => {
    const sandbox = await MockSandbox.create();
    expect(typeof sandbox[Symbol.asyncDispose]).toBe("function");
  });

  it("list returns empty pagination by default", async () => {
    const result = await MockSandbox.list();
    expect(result).toEqual({
      sandboxes: [],
      pagination: { count: 0, next: null, prev: null },
    });
  });

  it("property getters return correct values", async () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const sandbox = await MockSandbox.get({
      sandboxId: "sbx_custom",
      status: "running",
      timeout: 60_000,
      createdAt,
    });
    expect(sandbox.sandboxId).toBe("sbx_custom");
    expect(sandbox.status).toBe("running");
    expect(sandbox.timeout).toBe(60_000);
    expect(sandbox.createdAt).toEqual(createdAt);
  });
});

describe(MockCommand, () => {
  it("stdout returns configured string", async () => {
    const cmd = new MockCommand({ stdout: "hello output" });
    await expect(cmd.stdout()).resolves.toBe("hello output");
  });

  it("stderr returns configured string", async () => {
    const cmd = new MockCommand({ stderr: "error output" });
    await expect(cmd.stderr()).resolves.toBe("error output");
  });

  it("output('both') concatenates stdout and stderr", async () => {
    const cmd = new MockCommand({ stdout: "out", stderr: "err" });
    await expect(cmd.output("both")).resolves.toBe("outerr");
  });

  it("wait returns MockCommandFinished with exitCode", async () => {
    const cmd = new MockCommand({ exitCode: 42 });
    const finished = await cmd.wait();
    expect(finished.exitCode).toBe(42);
  });

  it("wait defaults exitCode to 0 if null", async () => {
    const cmd = new MockCommand();
    const finished = await cmd.wait();
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
    for await (const entry of cmd.logs()) {
      entries.push(entry);
    }
    expect(entries).toEqual([
      { stream: "stdout", data: "line1" },
      { stream: "stderr", data: "err1" },
    ]);
  });

  it("logs has Symbol.dispose and close", () => {
    const cmd = new MockCommand();
    const gen = cmd.logs();
    expect(typeof gen[Symbol.dispose]).toBe("function");
    expect(typeof gen.close).toBe("function");
  });

  it("kill resolves without error", async () => {
    const cmd = new MockCommand();
    await expect(cmd.kill()).resolves.toBeUndefined();
  });

  it("exitCode starts as null", () => {
    const cmd = new MockCommand();
    expect(cmd.exitCode).toBeNull();
  });

  it("cmdId, cwd, startedAt have defaults", () => {
    const cmd = new MockCommand();
    expect(typeof cmd.cmdId).toBe("string");
    expect(cmd.cwd).toBe("/");
    expect(typeof cmd.startedAt).toBe("number");
  });
});

describe(MockCommandFinished, () => {
  it("exitCode is number", () => {
    const finished = new MockCommandFinished({ exitCode: 5 });
    expect(finished.exitCode).toBe(5);
  });

  it("exitCode defaults to 0", () => {
    const finished = new MockCommandFinished();
    expect(finished.exitCode).toBe(0);
  });

  it("wait returns self", async () => {
    const finished = new MockCommandFinished();
    await expect(finished.wait()).resolves.toBe(finished);
  });
});

describe(MockSnapshot, () => {
  it("has sensible defaults", () => {
    const snap = new MockSnapshot();
    expect(typeof snap.snapshotId).toBe("string");
    expect(snap.status).toBe("created");
    expect(snap.sizeBytes).toBe(0);
    expect(snap.createdAt).toBeInstanceOf(Date);
    expect(snap.expiresAt).toBeUndefined();
  });

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
    expect(result.snapshots[1]!.snapshotId).toBe("b");
    expect(result.pagination.count).toBe(2);
  });
});
