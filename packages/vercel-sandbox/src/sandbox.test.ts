import { it, beforeEach, afterEach, expect, describe, vi } from "vitest";
import { PassThrough } from "stream";
import { consumeReadable } from "./utils/consume-readable.js";
import { Sandbox } from "./sandbox.js";
import { APIError } from "./api-client/api-error.js";
import type {
  APIClient,
  CommandData,
  SandboxMetaData,
} from "./api-client/index.js";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import ms from "ms";

describe("downloadFile validation", () => {
  it("throws when src is undefined", async () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      session: { id: "test" } as any,
      sandbox: { name: "test" } as any,
      projectId: "test-project",
    });
    await expect(
      sandbox.downloadFile(undefined as any, { path: "/tmp/out" }),
    ).rejects.toThrow("downloadFile: source path is required");
  });

  it("throws when src.path is empty", async () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      session: { id: "test" } as any,
      sandbox: { name: "test" } as any,
      projectId: "test-project",
    });
    await expect(
      sandbox.downloadFile({ path: "" }, { path: "/tmp/out" }),
    ).rejects.toThrow("downloadFile: source path is required");
  });

  it("throws when dst is undefined", async () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      session: { id: "test" } as any,
      sandbox: { name: "test" } as any,
      projectId: "test-project",
    });
    await expect(
      sandbox.downloadFile({ path: "file.txt" }, undefined as any),
    ).rejects.toThrow("downloadFile: destination path is required");
  });

  it("throws when dst.path is empty", async () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      session: { id: "test" } as any,
      sandbox: { name: "test" } as any,
      projectId: "test-project",
    });
    await expect(
      sandbox.downloadFile({ path: "file.txt" }, { path: "" }),
    ).rejects.toThrow("downloadFile: destination path is required");
  });
});

const makeSandboxMetadata = (): SandboxMetaData => ({
  name: "test-name",
  currentSessionId: "sbx_123",
  persistent: true,
  status: "running",
  memory: 2048,
  vcpus: 1,
  region: "iad1",
  runtime: "node24",
  timeout: 300_000,
  cwd: "/",
  updatedAt: 1,
  createdAt: 1,
  snapshotExpiration: 604800000,
});

const makeCommand = (): CommandData => ({
  id: "cmd_123",
  name: "echo",
  args: ["hello"],
  cwd: "/",
  sessionId: "sbx_123",
  exitCode: null,
  startedAt: 1,
});

describe("_runCommand error handling", () => {
  it("rejects non-detached runCommand when log streaming fails", async () => {
    const command = makeCommand();
    const logsError = new APIError(new Response("failed", { status: 500 }), {
      message: "Failed to stream logs",
      sessionId: "sbx_123",
    });

    const runCommandMock = vi.fn(async ({ wait }: { wait?: boolean }) => {
      if (wait) {
        return {
          command,
          finished: Promise.resolve({ ...command, exitCode: 0 }),
        };
      }

      return { json: { command } };
    });

    const getLogsMock = vi.fn(() =>
      (async function* () {
        throw logsError;
      })(),
    );

    const sandbox = new Sandbox({
      client: {
        runCommand: runCommandMock,
        getLogs: getLogsMock,
      } as unknown as APIClient,
      routes: [],
      sandbox: makeSandboxMetadata(),
      session: {} as any,
      projectId: "test-project",
    });

    await expect(
      sandbox.runCommand({
        cmd: "echo",
        args: ["hello"],
        stdout: new PassThrough(),
      }),
    ).rejects.toBe(logsError);
  });

  it("emits detached log streaming errors on the provided output stream", async () => {
    const command = makeCommand();
    const logsError = new APIError(new Response("failed", { status: 500 }), {
      message: "Failed to stream logs",
      sessionId: "sbx_123",
    });

    const runCommandMock = vi.fn(async ({ wait }: { wait?: boolean }) => {
      if (wait) {
        return {
          command,
          finished: Promise.resolve({ ...command, exitCode: 0 }),
        };
      }

      return { json: { command } };
    });

    const getLogsMock = vi.fn(() =>
      (async function* () {
        throw logsError;
      })(),
    );

    const sandbox = new Sandbox({
      client: {
        runCommand: runCommandMock,
        getLogs: getLogsMock,
      } as unknown as APIClient,
      routes: [],
      sandbox: makeSandboxMetadata(),
      session: {} as any,
      projectId: "test-project",
    });

    const stdout = new PassThrough();
    const errorEvent = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Expected stdout error event")),
        100,
      );
      stdout.once("error", (err) => {
        clearTimeout(timer);
        resolve(err);
      });
    });

    const detached = await sandbox.runCommand({
      cmd: "echo",
      args: ["hello"],
      detached: true,
      stdout,
    });

    expect(detached.cmdId).toBe("cmd_123");
    await expect(errorEvent).resolves.toBe(logsError);
  });
});

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")("Sandbox", () => {
  const PORTS = [3000, 4000];
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await Sandbox.create({ ports: PORTS });
  });

  afterEach(async () => {
    await sandbox.stop();
  });

  it("allows to write files and then read them as a stream", async () => {
    await sandbox.writeFiles([
      { path: "hello1.txt", content: Buffer.from("Hello 1") },
      { path: "hello2.txt", content: Buffer.from("Hello 2") },
    ]);

    const content1 = await sandbox.readFile({ path: "hello1.txt" });
    const content2 = await sandbox.readFile({ path: "hello2.txt" });
    expect((await consumeReadable(content1!)).toString()).toBe("Hello 1");
    expect((await consumeReadable(content2!)).toString()).toBe("Hello 2");
  });

  it("allows to write files and then read them to a buffer", async () => {
    await sandbox.writeFiles([
      { path: "hello1.txt", content: Buffer.from("Hello 1") },
      { path: "hello2.txt", content: Buffer.from("Hello 2") },
    ]);

    const content1 = await sandbox.readFileToBuffer({ path: "hello1.txt" });
    const content2 = await sandbox.readFileToBuffer({ path: "hello2.txt" });
    expect(content1?.toString()).toBe("Hello 1");
    expect(content2?.toString()).toBe("Hello 2");
  });

  it("returns null when reading a non-existent file to buffer", async () => {
    const content = await sandbox.readFileToBuffer({
      path: "non-existent.txt",
    });
    expect(content).toBeNull();
  });

  it("allows downloading a file from the sandbox", async () => {
    const fileContent = "Hello from sandbox";
    await sandbox.writeFiles([
      { path: "download-test.txt", content: Buffer.from(fileContent) },
    ]);

    const tmpDir = await mkdtemp(join(tmpdir(), "sandbox-test-"));

    try {
      const result = await sandbox.downloadFile(
        { path: "download-test.txt" },
        { path: "downloaded.txt", cwd: tmpDir },
      );
      expect(result).toBe(resolve(tmpDir, "downloaded.txt"));
      expect(await readFile(result!, "utf-8")).toBe(fileContent);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("returns null when downloading a non-existent file", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "sandbox-test-"));

    try {
      const result = await sandbox.downloadFile(
        { path: "non-existent.txt" },
        { path: "should-not-exist.txt", cwd: tmpDir },
      );
      expect(result).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("creates parent directories when mkdirRecursive is true", async () => {
    const fileContent = "Hello from sandbox";
    await sandbox.writeFiles([
      { path: "download-test.txt", content: Buffer.from(fileContent) },
    ]);

    const tmpDir = await mkdtemp(join(tmpdir(), "sandbox-test-"));
    const nestedPath = join(tmpDir, "nested", "dir", "downloaded.txt");

    try {
      const result = await sandbox.downloadFile(
        { path: "download-test.txt" },
        { path: nestedPath },
        { mkdirRecursive: true },
      );
      expect(result).toBe(nestedPath);
      expect(await readFile(result!, "utf-8")).toBe(fileContent);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it("verifies port forwarding works correctly", async () => {
    const serverScript = `
const http = require('http');
const ports = process.argv.slice(2);

for (const port of ports) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(\`hello port \${port}\`);
  });

  server.listen(port, () => {
    console.log(\`Server running on port \${port}\`);
  });
}
`;

    await sandbox.writeFiles([
      { path: "server.js", content: Buffer.from(serverScript) },
    ]);

    const server = await sandbox.runCommand({
      cmd: "node",
      args: ["server.js", ...PORTS.map(String)],
      detached: true,
      stdout: process.stdout,
      stderr: process.stderr,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    for (const port of PORTS) {
      const response = await fetch(sandbox.domain(port));
      const text = await response.text();
      expect(text).toBe(`hello port ${port}`);
    }

    await server.kill();
  });

  it("allows extending the sandbox timeout", async () => {
    const session = sandbox.currentSession();
    const originalTimeout = session.timeout;
    const extensionDuration = ms("5m");

    await sandbox.extendTimeout(extensionDuration);
    expect(session.timeout).toEqual(originalTimeout + extensionDuration);
  });

  it("auto-resumes a stopped session when running a command", async () => {
    await sandbox.stop();
    const result = await sandbox.runCommand("echo", ["resumed!"]);
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toContain("resumed!");
  });

  it("auto-resumes a stopped session when reading a file", async () => {
    await sandbox.writeFiles([
      { path: "persist.txt", content: Buffer.from("persisted content") },
    ]);
    await sandbox.stop();

    const content = await sandbox.readFileToBuffer({ path: "persist.txt" });
    expect(content?.toString()).toBe("persisted content");
  });

  it("raises an error when the timeout cannot be updated", async () => {
    try {
      await sandbox.extendTimeout(ms("5d"));
      expect.fail("Expected extendTimeout to throw an error");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      expect(error).toMatchObject({
        response: { status: 400 },
        json: {
          error: { code: "sandbox_timeout_invalid" },
        },
      });
    }
  });

  it("returns not found when getting a deleted sandbox", async () => {
    const sandbox = await Sandbox.create();
    const name = sandbox.name;
    await sandbox.delete();

    try {
      await Sandbox.get({ name });
      expect.fail("Expected Sandbox.get to throw an error");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      expect(error).toMatchObject({
        response: { status: 404 },
      });
    }
  });

  it("lists two sessions after stop and resume", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.stop();

    const resumed = await Sandbox.get({ name: sandbox.name, resume: true });
    const { sessions } = await resumed.listSessions();

    expect(sessions).toHaveLength(2);

    const currentSessionId = resumed.currentSession().sessionId;
    const match = sessions.find((s) => s.id === currentSessionId);
    expect(match).toBeDefined();
  });

  it("lists one snapshot after creating one", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.snapshot();

    const { snapshots } = await sandbox.listSnapshots();
    expect(snapshots).toHaveLength(1);
  });

  it("reflects updated resources after update", async () => {
    const sandbox = await Sandbox.create({
      timeout: 60_000,
      persistent: true,
      snapshotExpiration: 7 * 86400000,
      keepLastSnapshots: { count: 3 },
    });
    expect(sandbox.snapshotExpiration).toBe(7 * 86400000);
    expect(sandbox.keepLastSnapshots).toMatchObject({
      count: 3,
      deleteEvicted: true,
    });
    await sandbox.stop();

    const { snapshotId } = await sandbox.snapshot();

    await sandbox.update({
      resources: { vcpus: 4 },
      timeout: 30_000,
      persistent: false,
      snapshotExpiration: 2 * 86400000,
      keepLastSnapshots: {
        count: 5,
        expiration: 3 * 86400000,
        deleteEvicted: false,
      },
      currentSnapshotId: snapshotId,
    });

    const updated = await Sandbox.get({
      name: sandbox.name,
      resume: false,
    });
    expect(updated.vcpus).toBe(4);
    expect(updated.memory).toBe(8192);
    expect(updated.timeout).toBe(30_000);
    expect(updated.persistent).toBe(false);
    expect(updated.snapshotExpiration).toBe(2 * 86400000);
    expect(updated.keepLastSnapshots).toEqual({
      count: 5,
      expiration: 3 * 86400000,
      deleteEvicted: false,
    });
    expect(updated.currentSnapshotId).toBe(snapshotId);
  });

  it("clears keepLastSnapshots when updated with null", async () => {
    const sandbox = await Sandbox.create({
      persistent: true,
      keepLastSnapshots: {
        count: 2,
        expiration: 7 * 86400000,
        deleteEvicted: true,
      },
    });
    expect(sandbox.keepLastSnapshots).toMatchObject({ count: 2 });

    await sandbox.update({ keepLastSnapshots: null });

    const cleared = await Sandbox.get({
      name: sandbox.name,
      resume: false,
    });
    expect(cleared.keepLastSnapshots).toBeUndefined();
  });

  it("rejects snapshot deletion when the snapshot is in use, unless forceDelete is set", async () => {
    const sandbox = await Sandbox.create({
      name: `force-delete-${Date.now().toString(36)}`,
      persistent: true,
    });
    try {
      const snapshot = await sandbox.snapshot();
      // The snapshot is now the sandbox's currentSnapshotId — deletion must fail.
      await expect(snapshot.delete()).rejects.toMatchObject({
        response: { status: 400 },
        json: {
          error: {
            message: expect.stringMatching(/in use/i),
          },
        },
      });

      // With forceDelete the same call succeeds.
      await snapshot.delete({ forceDelete: true });
      expect(snapshot.status).toBe("deleted");
    } finally {
      await sandbox.delete();
    }
  });

  it("appears in the sandbox list after creation", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.stop();
    const { sandboxes } = await Sandbox.list({ limit: 1 });
    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0].name).toBe(sandbox.name);
  });

  it("calls onResume when Sandbox.get resumes a stopped sandbox", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.stop();

    let resumedSandbox: Sandbox | null = null;
    const retrieved = await Sandbox.get({
      name: sandbox.name,
      resume: true,
      onResume: async (sbx) => {
        resumedSandbox = sbx;
      },
    });

    expect(resumedSandbox).toBe(retrieved);
  });

  it("calls onResume on auto-resume after a stopped session", async () => {
    let resumeCount = 0;
    const sandbox = await Sandbox.create({
      onResume: async () => {
        resumeCount++;
      },
    });

    await sandbox.stop();
    await sandbox.runCommand("echo", ["hello"]);

    expect(resumeCount).toBe(1);
  });

  it("updates status and currentSnapshotId after stopping a persistent sandbox", async () => {
    const sandbox = await Sandbox.create({ persistent: true });
    expect(sandbox.status).toBe("running");

    await sandbox.stop();

    expect(sandbox.status).toBe("stopped");
    expect(sandbox.currentSnapshotId).not.toBeNull();
  });

  it("does not call onResume when Sandbox.get does not resume", async () => {
    const sandbox = await Sandbox.create();

    let called = false;
    await Sandbox.get({
      name: sandbox.name,
      resume: true,
      onResume: async () => {
        called = true;
      },
    });

    expect(called).toBe(false);
  });
});
