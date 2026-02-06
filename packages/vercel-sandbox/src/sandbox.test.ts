import { it, beforeEach, afterEach, expect, describe } from "vitest";
import { consumeReadable } from "./utils/consume-readable";
import { Sandbox } from "./sandbox";
import { APIError } from "./api-client/api-error";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import ms from "ms";

describe("downloadFile validation", () => {
  it("throws when src is undefined", async () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      sandbox: { id: "test" } as any,
    });
    await expect(
      sandbox.downloadFile(undefined as any, { path: "/tmp/out" }),
    ).rejects.toThrow("downloadFile: source path is required");
  });

  it("throws when src.path is empty", async () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      sandbox: { id: "test" } as any,
    });
    await expect(
      sandbox.downloadFile({ path: "" }, { path: "/tmp/out" }),
    ).rejects.toThrow("downloadFile: source path is required");
  });

  it("throws when dst is undefined", async () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      sandbox: { id: "test" } as any,
    });
    await expect(
      sandbox.downloadFile({ path: "file.txt" }, undefined as any),
    ).rejects.toThrow("downloadFile: destination path is required");
  });

  it("throws when dst.path is empty", async () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      sandbox: { id: "test" } as any,
    });
    await expect(
      sandbox.downloadFile({ path: "file.txt" }, { path: "" }),
    ).rejects.toThrow("downloadFile: destination path is required");
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
    const originalTimeout = sandbox.timeout;
    const extensionDuration = ms("5m");

    await sandbox.extendTimeout(extensionDuration);
    expect(sandbox.timeout).toEqual(originalTimeout + extensionDuration);
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
});
