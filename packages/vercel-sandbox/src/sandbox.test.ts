import { it, beforeEach, afterEach, expect, describe, vi } from "vitest";
import { PassThrough } from "stream";
import { consumeReadable } from "./utils/consume-readable.js";
import { Sandbox } from "./sandbox.js";
import { Snapshot } from "./snapshot.js";
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

describe("Sandbox.getOrCreate", () => {
  const CREDENTIALS = {
    token: "test-token",
    teamId: "team_123",
    projectId: "proj_123",
  };

  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("propagates non-404 errors from Sandbox.get without attempting create", async () => {
    // 403 is non-retryable (<500 and !=429), so it surfaces immediately.
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse(403, { error: { code: "forbidden", message: "nope" } }),
    );
    const onCreate = vi.fn<(sandbox: Sandbox) => Promise<void>>();

    await expect(
      Sandbox.getOrCreate({
        ...CREDENTIALS,
        name: "my-sandbox",
        fetch: mockFetch as unknown as typeof fetch,
        onCreate,
      }),
    ).rejects.toBeInstanceOf(APIError);

    // Only the get call should have been made — no create attempt.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/v2/sandboxes/my-sandbox");
    expect(init?.method ?? "GET").toBe("GET");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("propagates create errors when a name race occurs after a 404 from get", async () => {
    const mockFetch = vi.fn<typeof fetch>(async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return jsonResponse(404, {
          error: { code: "not_found", message: "not found" },
        });
      }
      if (method === "POST") {
        return jsonResponse(400, {
          error: {
            code: "bad_request",
            message:
              "A sandbox with the name 'my-sandbox' already exists for this project.",
          },
        });
      }
      throw new Error(`Unexpected method ${method} to ${String(input)}`);
    });
    const onCreate = vi.fn<(sandbox: Sandbox) => Promise<void>>();

    const promise = Sandbox.getOrCreate({
      ...CREDENTIALS,
      name: "my-sandbox",
      fetch: mockFetch as unknown as typeof fetch,
      onCreate,
    });

    await expect(promise).rejects.toBeInstanceOf(APIError);
    await expect(promise).rejects.toMatchObject({
      response: { status: 400 },
      json: { error: { code: "bad_request" } },
    });

    // One GET (get-sandbox 404) + one POST (create 400). onCreate must not fire.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")("Sandbox", () => {
  const PORTS = [3000, 4000];
  const SNAPSHOT_EXPIRATION = ms("1d");

  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await Sandbox.create({
      ports: PORTS,
      persistent: false,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
    });
  });

  afterEach(async () => {
    await sandbox.delete();
  }, 30_000);

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
    const sbx = await Sandbox.create({
      persistent: true,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
    });
    try {
      await sbx.stop();
      const result = await sbx.runCommand("echo", ["resumed!"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("resumed!");
    } finally {
      await sbx.delete();
    }
  });

  it("auto-resumes a stopped session when reading a file", async () => {
    const sbx = await Sandbox.create({
      persistent: true,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
    });

    try {
      await sbx.writeFiles([
        { path: "persist.txt", content: Buffer.from("persisted content") },
      ]);
      await sbx.stop();

      const content = await sbx.readFileToBuffer({ path: "persist.txt" });
      expect(content?.toString()).toBe("persisted content");
    } finally {
      await sbx.delete();
    }
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
    const sbx = await Sandbox.create({
      persistent: false,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
    });
    const name = sbx.name;
    await sbx.delete();

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
    const sbx = await Sandbox.create({
      persistent: true,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
    });

    try {
      await sbx.stop();

      const resumed = await Sandbox.get({ name: sbx.name, resume: true });
      const { sessions } = await resumed.listSessions();

      expect(sessions).toHaveLength(2);

      const currentSessionId = resumed.currentSession().sessionId;
      const match = sessions.find((s) => s.id === currentSessionId);
      expect(match).toBeDefined();
    } finally {
      await sbx.delete();
    }
  });

  it("lists one snapshot after creating one", async () => {
    await sandbox.snapshot();

    const { snapshots } = await sandbox.listSnapshots();
    expect(snapshots).toHaveLength(1);
  });

  it("reflects updated resources after update", async () => {
    const sbx = await Sandbox.create({
      timeout: 60_000,
      persistent: true,
      snapshotExpiration: 7 * 86400000,
    });

    try {
      expect(sbx.snapshotExpiration).toBe(7 * 86400000);
      await sbx.stop();

      const { snapshotId } = await sbx.snapshot();

      await sbx.update({
        resources: { vcpus: 4 },
        timeout: 30_000,
        persistent: false,
        snapshotExpiration: 2 * 86400000,
        currentSnapshotId: snapshotId,
      });

      const updated = await Sandbox.get({
        name: sbx.name,
        resume: false,
      });
      expect(updated.vcpus).toBe(4);
      expect(updated.memory).toBe(8192);
      expect(updated.timeout).toBe(30_000);
      expect(updated.persistent).toBe(false);
      expect(updated.snapshotExpiration).toBe(2 * 86400000);
      expect(updated.currentSnapshotId).toBe(snapshotId);
    } finally {
      await sbx.delete();
    }
  });

  it("appears in the sandbox list after creation", async () => {
    await sandbox.stop();
    const { sandboxes } = await Sandbox.list({ limit: 1 });
    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0].name).toBe(sandbox.name);
  });

  it("calls onResume when Sandbox.get resumes a stopped sandbox", async () => {
    const sbx = await Sandbox.create({
      persistent: true,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
    });

    try {
      await sbx.stop();

      let resumedSandbox: Sandbox | null = null;
      const retrieved = await Sandbox.get({
        name: sbx.name,
        resume: true,
        onResume: async (s) => {
          resumedSandbox = s;
        },
      });

      expect(resumedSandbox).toBe(retrieved);
    } finally {
      await sbx.delete();
    }
  });

  it("calls onResume on auto-resume after a stopped session", async () => {
    let resumeCount = 0;
    const sbx = await Sandbox.create({
      persistent: true,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      onResume: async () => {
        resumeCount++;
      },
    });

    try {
      await sbx.stop();
      await sbx.runCommand("echo", ["hello"]);

      expect(resumeCount).toBe(1);
    } finally {
      await sbx.delete();
    }
  });

  it("updates status and currentSnapshotId after stopping a persistent sandbox", async () => {
    const sbx = await Sandbox.create({
      persistent: true,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
    });

    try {
      expect(sbx.status).toBe("running");

      await sbx.stop();

      expect(sbx.status).toBe("stopped");
      expect(sbx.currentSnapshotId).not.toBeNull();
    } finally {
      await sbx.delete();
    }
  });

  it("does not call onResume when Sandbox.get does not resume", async () => {
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

  it("paginates Sandbox.list across multiple pages", async () => {
    const tag = `pagination-${Date.now()}`;
    const [a, b] = await Promise.all([
      Sandbox.create({ tags: { test: tag } }),
      Sandbox.create({ tags: { test: tag } }),
    ]);
    await Promise.all([a.stop(), b.stop()]);

    const firstPage = await Sandbox.list({ limit: 1, tags: { test: tag } });
    expect(firstPage.sandboxes).toHaveLength(1);
    expect(firstPage.pagination.next).not.toBeNull();

    const all = await firstPage.toArray();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((s) => s.name))).toEqual(
      new Set([a.name, b.name]),
    );
  });

  it("paginates listSessions across multiple pages", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.stop();
    await Sandbox.get({ name: sandbox.name, resume: true });

    const firstPage = await sandbox.listSessions({ limit: 1 });
    expect(firstPage.sessions).toHaveLength(1);
    expect(firstPage.pagination.next).not.toBeNull();

    const all = await firstPage.toArray();
    expect(all).toHaveLength(2);
  });

  it("paginates listSnapshots across multiple pages", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.snapshot();
    await sandbox.snapshot();

    const firstPage = await sandbox.listSnapshots({ limit: 1 });
    expect(firstPage.snapshots).toHaveLength(1);
    expect(firstPage.pagination.next).not.toBeNull();

    const all = await firstPage.toArray();
    expect(all).toHaveLength(2);
  });

  it("paginates Snapshot.list across multiple pages", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.snapshot();
    await sandbox.snapshot();

    const firstPage = await Snapshot.list({ name: sandbox.name, limit: 1 });
    expect(firstPage.snapshots).toHaveLength(1);
    expect(firstPage.pagination.next).not.toBeNull();

    const all = await firstPage.toArray();
    expect(all).toHaveLength(2);
  });

  describe("getOrCreate", () => {
    it("creates a new sandbox and fires onCreate when no name is provided", async () => {
      const onCreate = vi.fn<(sandbox: Sandbox) => Promise<void>>(
        async () => {},
      );
      sandbox = await Sandbox.getOrCreate({
        persistent: false,
        snapshotExpiration: SNAPSHOT_EXPIRATION,
        onCreate,
      });

      expect(sandbox.status).toBe("running");
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate.mock.calls[0][0]).toBe(sandbox);
    });

    it("returns the existing sandbox without firing onCreate when the name exists", async () => {
      const onCreate = vi.fn<(sandbox: Sandbox) => Promise<void>>(
        async () => {},
      );
      const fetched = await Sandbox.getOrCreate({
        name: sandbox.name,
        onCreate,
      });

      expect(fetched.name).toBe(sandbox.name);
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("creates a new sandbox with the given name and fires onCreate when the name does not exist", async () => {
      const name = `goc-new-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const onCreate = vi.fn<(sandbox: Sandbox) => Promise<void>>(
        async () => {},
      );

      sandbox = await Sandbox.getOrCreate({
        name,
        persistent: false,
        snapshotExpiration: SNAPSHOT_EXPIRATION,
        onCreate,
      });

      expect(sandbox.name).toBe(name);
      expect(sandbox.status).toBe("running");
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate.mock.calls[0][0]).toBe(sandbox);
    });

    it("recreates the sandbox with the same name when the snapshot is missing", async () => {
      // A persistent sandbox + stop() reliably creates a snapshot and
      // updates `currentSnapshotId`. Deleting that snapshot makes the next
      // resume fail with `snapshot_not_found`.
      sandbox = await Sandbox.create({
        persistent: true,
        snapshotExpiration: SNAPSHOT_EXPIRATION,
      });
      const name = sandbox.name;
      const originalSessionId = sandbox.currentSession().sessionId;
      await sandbox.stop();

      const snapshotId = sandbox.currentSnapshotId;
      expect(snapshotId).not.toBeNull();
      const snapshot = await Snapshot.get({ snapshotId: snapshotId! });
      await snapshot.delete();

      const onCreate = vi.fn<(sandbox: Sandbox) => Promise<void>>(
        async () => {},
      );
      sandbox = await Sandbox.getOrCreate({
        name,
        persistent: true,
        snapshotExpiration: SNAPSHOT_EXPIRATION,
        resume: true,
        onCreate,
      });

      expect(sandbox.name).toBe(name);
      expect(sandbox.currentSession().sessionId).not.toBe(originalSessionId);
      expect(sandbox.status).toBe("running");
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate.mock.calls[0][0]).toBe(sandbox);
    });
  });
});
