import { afterEach, describe, expect, test } from "vitest";
import { Sandbox, setupSandbox } from "./sandbox";
import { Session } from "./session";
import { command } from "./handlers";
import { APIError, Snapshot } from "./stubs";
import { expectForkToPreserveSnapshotFileSystem } from "./test-scenarios";

describe(Sandbox, () => {
  test("create() returns a Sandbox with name", async () => {
    const sandbox = await Sandbox.create();
    expect(typeof sandbox.name).toBe("string");
    expect(sandbox.name.length).toBeGreaterThan(0);
    await sandbox.stop();
  });

  test("create() with explicit name", async () => {
    const sandbox = await Sandbox.create({ name: "my-sandbox" });
    expect(sandbox.name).toBe("my-sandbox");
    await sandbox.delete();
  });

  test('status starts as "running", becomes "stopped" after stop()', async () => {
    const sandbox = await Sandbox.create();
    expect(sandbox.status).toBe("running");
    await sandbox.stop();
    expect(sandbox.status).toBe("stopped");
  });

  test("default getters return expected values", async () => {
    const sandbox = await Sandbox.create();
    expect(sandbox.persistent).toBe(false);
    expect(sandbox.region).toBe("mock");
    expect(sandbox.vcpus).toBe(1);
    expect(sandbox.memory).toBe(2048);
    expect(sandbox.runtime).toBe("node24");
    expect(sandbox.createdAt).toBeInstanceOf(Date);
    expect(sandbox.updatedAt).toBeInstanceOf(Date);
    expect(sandbox.interactivePort).toBeUndefined();
    expect(sandbox.totalEgressBytes).toBeUndefined();
    expect(sandbox.totalIngressBytes).toBeUndefined();
    expect(sandbox.totalActiveCpuDurationMs).toBeUndefined();
    expect(sandbox.totalDurationMs).toBeUndefined();
    expect(sandbox.sourceSnapshotId).toBeUndefined();
    expect(sandbox.currentSnapshotId).toBeUndefined();
    expect(sandbox.snapshotExpiration).toBeUndefined();
    expect(sandbox.statusUpdatedAt).toBeUndefined();
    expect(sandbox.cwd).toBe("/vercel/sandbox");
    expect(sandbox.expiresAt).toBeInstanceOf(Date);
    expect(sandbox.keepLastSnapshots).toBeUndefined();
    await sandbox.stop();
  });

  test("filesystem facade supports node-style reads and writes", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.fs.writeFile("/tmp/fs.txt", "hello");
    await sandbox.fs.appendFile("/tmp/fs.txt", " world");
    expect(await sandbox.fs.readFile("/tmp/fs.txt", "utf8")).toBe("hello world");
    const stats = await sandbox.fs.stat("/tmp/fs.txt");
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBe(11);
    await sandbox.stop();
  });

  test("openInteractive returns mock connection credentials", async () => {
    const sandbox = await Sandbox.create();
    const interactive = await sandbox.openInteractive();
    expect(interactive.url).toMatch(/^wss:\/\//);
    expect(interactive.token).toBeTypeOf("string");
    await sandbox.stop();
  });

  test("timeout and tags from params", async () => {
    const sandbox = await Sandbox.create({
      timeout: 60_000,
      tags: { env: "test" },
    });
    expect(sandbox.timeout).toBe(60_000);
    expect(sandbox.tags).toEqual({ env: "test" });
    await sandbox.stop();
  });

  test("[Symbol.asyncDispose] exists and stops the sandbox", async () => {
    const sandbox = await Sandbox.create();
    expect(typeof sandbox[Symbol.asyncDispose]).toBe("function");
    await sandbox[Symbol.asyncDispose]();
    expect(sandbox.status).toBe("stopped");
  });

  test("currentSession() returns a Session", async () => {
    const sandbox = await Sandbox.create();
    const session = sandbox.currentSession();
    expect(session).toBeInstanceOf(Session);
    expect(session.status).toBe("running");
    await sandbox.stop();
  });

  test("runCommand delegates to current session", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toContain("hello");
    await sandbox.stop();
  });

  test("runCommand object form", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand({ cmd: "echo", args: ["obj"] });
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toContain("obj");
    await sandbox.stop();
  });

  test("handler output respects ordered file descriptor redirections", async () => {
    const handler = command("mycmd", {
      stdout: "captured stdout\n",
      stderr: "captured stderr\n",
      exitCode: 1,
    });
    const sandbox = await Sandbox.create({ handlers: [handler] });

    const result = await sandbox.runCommand("mycmd > /tmp/captured 2>&1");

    expect(await result.stdout()).toBe("");
    expect(await result.stderr()).toBe("");
    const captured = await sandbox.readFileToBuffer({ path: "/tmp/captured" });
    expect(captured?.toString()).toBe("captured stdout\ncaptured stderr\n");
    await sandbox.stop();
  });

  test("writeFiles + readFile roundtrip", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.writeFiles([{ path: "/tmp/test.txt", content: Buffer.from("sandbox test") }]);
    const buf = await sandbox.readFileToBuffer({ path: "/tmp/test.txt" });
    expect(buf!.toString()).toBe("sandbox test");
    await sandbox.stop();
  });

  test("writeFiles + readFileToBuffer preserves binary bytes", async () => {
    const sandbox = await Sandbox.create();
    const content = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41]);

    await sandbox.writeFiles([{ path: "/tmp/binary.bin", content }]);

    expect(await sandbox.readFileToBuffer({ path: "/tmp/binary.bin" })).toEqual(content);
    await sandbox.stop();
  });

  test("domain(port) works with configured ports", async () => {
    const sandbox = await Sandbox.create({ ports: [3000] });
    const url = sandbox.domain(3000);
    expect(url).toContain("3000");
    expect(url).toMatch(/^https:\/\//);
    await sandbox.stop();
  });

  test("domain() throws for unconfigured port", async () => {
    const sandbox = await Sandbox.create();
    expect(() => sandbox.domain(9999)).toThrow();
    await sandbox.stop();
  });

  test("routes populated from ports", async () => {
    const sandbox = await Sandbox.create({ ports: [3000, 8080] });
    expect(sandbox.routes).toHaveLength(2);
    await sandbox.stop();
  });

  test("Sandbox.get() with existing name", async () => {
    const sandbox = await Sandbox.create({ name: "get-test" });
    const retrieved = await Sandbox.get({ name: "get-test" });
    expect(retrieved.name).toBe("get-test");
    await sandbox.delete();
  });

  test("Sandbox.get() with unknown name throws APIError 404", async () => {
    await expect(Sandbox.get({ name: "unknown-sandbox" })).rejects.toThrow(APIError);
    await expect(Sandbox.get({ name: "unknown-sandbox" })).rejects.toSatisfy(
      (error: APIError) => error.response.status === 404,
    );
  });

  test("Sandbox.getOrCreate() initializes a named sandbox only once", async () => {
    let createCount = 0;
    const first = await Sandbox.getOrCreate({
      name: "get-or-create-test",
      onCreate: async (sandbox) => {
        createCount++;
        await sandbox.fs.writeFile("/tmp/initialized.txt", "ready");
      },
    });
    const second = await Sandbox.getOrCreate({
      name: "get-or-create-test",
      onCreate: async () => {
        createCount++;
      },
    });

    expect(second).toBe(first);
    expect(createCount).toBe(1);
    expect(await second.fs.readFile("/tmp/initialized.txt", "utf8")).toBe("ready");
    await first.delete();
  });

  test("Sandbox.getOrCreate() initializes concurrent callers only once", async () => {
    let createCount = 0;
    const sandboxes = await Promise.all(
      Array.from({ length: 5 }, () =>
        Sandbox.getOrCreate({
          name: "concurrent-get-or-create-test",
          onCreate: async (sandbox) => {
            createCount++;
            await sandbox.fs.writeFile("/tmp/initialized.txt", "ready");
          },
        }),
      ),
    );

    expect(new Set(sandboxes).size).toBe(1);
    expect(createCount).toBe(1);
    expect(await sandboxes[0].fs.readFile("/tmp/initialized.txt", "utf8")).toBe("ready");
    await sandboxes[0].delete();
  });

  test("Sandbox.fork() restores the latest snapshot with configuration overrides", async () => {
    const source = await Sandbox.create({
      name: "fork-source",
      persistent: true,
      ports: [3000],
      timeout: 60_000,
      tags: { role: "source" },
      networkPolicy: "deny-all",
    });
    await source.fs.writeFile("/tmp/source.txt", "from snapshot");
    const snapshot = await source.snapshot();
    await source.fs.writeFile("/tmp/source.txt", "after snapshot");

    const fork = await Sandbox.fork({
      sourceSandbox: "fork-source",
      name: "fork-target",
      resources: { vcpus: 2 },
    });

    expect(fork.name).toBe("fork-target");
    expect(fork.persistent).toBe(true);
    expect(fork.timeout).toBe(60_000);
    expect(fork.vcpus).toBe(2);
    expect(fork.tags).toEqual({ role: "source" });
    expect(fork.networkPolicy).toBe("deny-all");
    expect(fork.routes.map((route) => route.port)).toEqual([3000]);
    expect(source.currentSnapshotId).toBe(snapshot.snapshotId);
    expect(await fork.fs.readFile("/tmp/source.txt", "utf8")).toBe("from snapshot");

    await fork.delete();
    await source.delete();
  });

  test("Sandbox.fork() starts fresh when the source has no snapshot", async () => {
    const source = await Sandbox.create({ name: "fresh-fork-source", runtime: "node22" });
    await source.fs.writeFile("/tmp/source-only.txt", "not snapshotted");

    const fork = await Sandbox.fork({
      sourceSandbox: "fresh-fork-source",
      name: "fresh-fork-target",
    });

    expect(fork.runtime).toBe("node22");
    expect(await fork.fs.exists("/tmp/source-only.txt")).toBe(false);

    await fork.delete();
    await source.delete();
  });

  test("Sandbox.fork() preserves the complete snapshot filesystem", async () => {
    await expectForkToPreserveSnapshotFileSystem(Sandbox);
  });

  test("Sandbox.list() filters, sorts, and paginates the sandbox lifecycle", async () => {
    const first = await Sandbox.create({ name: "list-page-alpha" });
    const second = await Sandbox.create({ name: "list-page-beta", persistent: true });

    const created = await Sandbox.list({
      namePrefix: "list-page-",
      sortBy: "name",
      sortOrder: "asc",
      limit: 1,
    });
    expect(created.sandboxes).toEqual([
      expect.objectContaining({
        name: "list-page-alpha",
        persistent: false,
        status: "running",
        region: "mock",
        currentSessionId: first.currentSession().sessionId,
      }),
    ]);
    expect(created.pagination).toEqual({ count: 1, next: "1" });
    const next = await Sandbox.list({
      namePrefix: "list-page-",
      sortBy: "name",
      sortOrder: "asc",
      limit: 1,
      cursor: created.pagination.next!,
    });
    expect(next.sandboxes.map(({ name }) => name)).toEqual(["list-page-beta"]);
    expect(next.pagination).toEqual({ count: 1, next: null });
    const pages = [];
    for await (const page of created.pages()) pages.push(page);
    expect(pages.map((page) => page.sandboxes.map(({ name }) => name))).toEqual([
      ["list-page-alpha"],
      ["list-page-beta"],
    ]);
    expect((await created.toArray()).map(({ name }) => name)).toEqual([
      "list-page-alpha",
      "list-page-beta",
    ]);

    await first.delete();
    const afterDelete = await Sandbox.list({ namePrefix: "list-page-", sortBy: "name" });
    expect(afterDelete.sandboxes.map(({ name }) => name)).toEqual(["list-page-beta"]);

    await second.delete();
  });

  test("update() modifies sandbox configuration", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.update({
      persistent: true,
      resources: { vcpus: 2 },
      timeout: 120_000,
      tags: { env: "production" },
      networkPolicy: "deny-all",
      keepLastSnapshots: { count: 2, deleteEvicted: false },
    });
    expect(sandbox.persistent).toBe(true);
    expect(sandbox.timeout).toBe(120_000);
    expect(sandbox.tags).toEqual({ env: "production" });
    expect(sandbox.networkPolicy).toBe("deny-all");
    expect(sandbox.keepLastSnapshots).toEqual({ count: 2, deleteEvicted: false });
    // The new timeout (120s) is lower than the running session's (default 300s).
    // A decrease updates the sandbox default but does not shrink the live
    // session, matching the real SDK.
    expect(sandbox.currentSession().timeout).toBe(300_000);
    expect(sandbox.currentSession().networkPolicy).toBe("deny-all");
    expect(sandbox.currentSession().vcpus).toBe(2);
    await sandbox.stop();
  });

  test("update() with a higher timeout extends the running session", async () => {
    const sandbox = await Sandbox.create({ timeout: 60_000 });
    await sandbox.update({ timeout: 120_000 });
    expect(sandbox.timeout).toBe(120_000);
    expect(sandbox.currentSession().timeout).toBe(120_000);
    await sandbox.stop();
  });

  test("delete() removes sandbox from tracking", async () => {
    const sandbox = await Sandbox.create({ name: "delete-test" });
    await sandbox.delete();
    await expect(Sandbox.get({ name: "delete-test" })).rejects.toThrow(APIError);
  });

  test("updateNetworkPolicy() stores and returns policy", async () => {
    const sandbox = await Sandbox.create();
    const policy = await sandbox.updateNetworkPolicy("deny-all");
    expect(policy).toBe("deny-all");
    expect(sandbox.networkPolicy).toBe("deny-all");
    await sandbox.stop();
  });

  test("extendTimeout() extends the running session, not the default", async () => {
    const sandbox = await Sandbox.create({ timeout: 60_000 });
    const before = sandbox.expiresAt!.getTime();
    await sandbox.extendTimeout(30_000);
    // The sandbox default timeout (used for future sessions) is unchanged,
    // but the running session's timeout — and thus expiresAt — grows.
    expect(sandbox.timeout).toBe(60_000);
    expect(sandbox.currentSession().timeout).toBe(90_000);
    expect(sandbox.expiresAt!.getTime()).toBe(before + 30_000);
    await sandbox.stop();
  });

  test("snapshot() returns a Snapshot", async () => {
    const sandbox = await Sandbox.create();
    const snap = await sandbox.snapshot();
    expect(snap).toBeInstanceOf(Snapshot);
    expect(snap.sourceSessionId).toBe(sandbox.currentSession().sessionId);
    await sandbox.stop();
  });

  test("snapshots remain coherent across create, list, get, and delete", async () => {
    const sandbox = await Sandbox.create({ name: "snapshot-lifecycle" });
    await sandbox.fs.writeFile("/tmp/state.txt", "captured");
    const created = await sandbox.snapshot();

    const sandboxSnapshots = await sandbox.listSnapshots();
    expect(sandboxSnapshots.snapshots).toEqual([
      expect.objectContaining({
        id: created.snapshotId,
        sourceSessionId: sandbox.currentSession().sessionId,
        status: "created",
      }),
    ]);
    expect(await sandboxSnapshots.toArray()).toEqual(sandboxSnapshots.snapshots);

    const allSnapshots = await Snapshot.list({ name: "snapshot-lifecycle" });
    expect(allSnapshots.snapshots.map(({ id }) => id)).toEqual([created.snapshotId]);

    const retrieved = await Snapshot.get({ snapshotId: created.snapshotId });
    expect(retrieved.snapshotId).toBe(created.snapshotId);
    expect(retrieved.sourceSessionId).toBe(created.sourceSessionId);

    await retrieved.delete();
    expect((await sandbox.listSnapshots()).snapshots).toEqual([
      expect.objectContaining({ id: created.snapshotId, status: "deleted" }),
    ]);
    expect((await Snapshot.get({ snapshotId: created.snapshotId })).status).toBe("deleted");

    await sandbox.delete();
  });

  test("getCommand returns previously run command", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["tracked"]);
    const retrieved = await sandbox.getCommand(result.cmdId);
    expect(retrieved.cmdId).toBe(result.cmdId);
    await sandbox.stop();
  });

  test("listSessions() returns session metadata", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.listSessions();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe(sandbox.currentSession().sessionId);
    expect(result.pagination.count).toBe(1);
    await sandbox.stop();
  });

  test("listSnapshots() returns empty list", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.listSnapshots();
    expect(result.snapshots).toHaveLength(0);
    expect(result.pagination.count).toBe(0);
    await sandbox.stop();
  });

  test("mkDir creates directory", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.mkDir("/tmp/test-dir");
    const result = await sandbox.runCommand("ls", ["/tmp/test-dir"]);
    expect(result.exitCode).toBe(0);
    await sandbox.stop();
  });

  test("downloadFile returns null for missing file", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.downloadFile({ path: "/src" }, { path: "/dst" });
    expect(result).toBeNull();
    await sandbox.stop();
  });
});

describe("session cycling", () => {
  test("stop + runCommand auto-resumes with new session", async () => {
    const sandbox = await Sandbox.create();
    const firstSession = sandbox.currentSession();
    const firstSessionId = firstSession.sessionId;
    await sandbox.stop();
    expect(sandbox.status).toBe("stopped");

    // Running a command should trigger resume
    const result = await sandbox.runCommand("echo", ["resumed"]);
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toContain("resumed");

    const secondSession = sandbox.currentSession();
    expect(secondSession.sessionId).not.toBe(firstSessionId);
    expect(secondSession.status).toBe("running");

    await sandbox.stop();
  });

  test("onResume callback is called on session cycling", async () => {
    let resumeCount = 0;
    const sandbox = await Sandbox.create({
      onResume: async () => {
        resumeCount++;
      },
    });

    await sandbox.stop();
    await sandbox.runCommand("echo", ["hi"]);
    expect(resumeCount).toBe(1);

    await sandbox.stop();
    await sandbox.runCommand("echo", ["hi"]);
    expect(resumeCount).toBe(2);

    await sandbox.stop();
  });

  test("listSessions() tracks all sessions after cycling", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.stop();
    await sandbox.runCommand("echo", ["second"]);
    await sandbox.stop();
    await sandbox.runCommand("echo", ["third"]);

    const result = await sandbox.listSessions();
    expect(result.sessions).toHaveLength(3);
    expect(result.pagination.count).toBe(3);
    expect(await result.toArray()).toEqual(result.sessions);

    await sandbox.stop();
  });
});

describe(setupSandbox, () => {
  const sandboxMock = setupSandbox(command("npm install", { stdout: "default\n" }));

  afterEach(() => sandboxMock.resetHandlers());

  test("use() overrides default handlers", async () => {
    sandboxMock.use(command("npm install", { stdout: "override\n" }));
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("npm", ["install"]);
    expect(await result.stdout()).toBe("override\n");
    await sandbox.stop();
  });

  test("use() overrides per-create handlers", async () => {
    sandboxMock.use(command("npm install", { stdout: "runtime\n" }));
    const sandbox = await Sandbox.create({
      handlers: [command("npm install", { stdout: "per-create\n" })],
    });
    const result = await sandbox.runCommand("npm", ["install"]);
    expect(await result.stdout()).toBe("runtime\n");
    await sandbox.stop();
  });

  test("resetHandlers() clears use() overrides but keeps defaults", async () => {
    sandboxMock.use(command("npm install", { stdout: "override\n" }));
    sandboxMock.resetHandlers();
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("npm", ["install"]);
    expect(await result.stdout()).toBe("default\n");
    await sandbox.stop();
  });
});
