import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("../../src/client", () => ({
  sandboxClient: { get: mockGet, create: vi.fn(), fork: vi.fn(), list: vi.fn() },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
}));

vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => false,
}));

/** A fake sandbox whose filesystem lives under a local temp directory. */
function fakeSandbox(root: string) {
  const resolve = (p: string) => path.join(root, p);
  return {
    writeFiles: vi.fn(
      async (files: { path: string; content: string | Uint8Array; mode?: number }[]) => {
        for (const file of files) {
          await fs.mkdir(path.dirname(resolve(file.path)), { recursive: true });
          await fs.writeFile(resolve(file.path), file.content);
          if (file.mode !== undefined) await fs.chmod(resolve(file.path), file.mode);
        }
      },
    ),
    readFile: async ({ path: p }: { path: string }) =>
      (await fs.stat(resolve(p)).catch(() => null))?.isFile()
        ? createReadStream(resolve(p))
        : null,
    readFileToBuffer: async ({ path: p }: { path: string }) =>
      fs.readFile(resolve(p)).catch(() => null),
    mkDir: async (p: string) => fs.mkdir(resolve(p), { recursive: true }),
    runCommand: async (command: string, args: string[]) => {
      expect(command).toBe("find");
      const [target, ...rest] = args;
      const stdout = execFileSync("find", [resolve(target), ...rest], {
        encoding: "utf8",
      });
      return { exitCode: 0, stdout: async () => stdout, stderr: async () => "" };
    },
  };
}

describe("file commands against a fake sandbox", () => {
  let tmp: string;
  let remoteRoot: string;
  let sandbox: ReturnType<typeof fakeSandbox>;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-files-"));
    remoteRoot = path.join(tmp, "remote");
    await fs.mkdir(remoteRoot);
    sandbox = fakeSandbox(remoteRoot);
    mockGet.mockResolvedValue(sandbox);
    process.env.VERCEL_AUTH_TOKEN = "tok";
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const scopeArgs = ["--scope=team", "--project=proj"];

  test("copy -r round-trips a directory tree, keeping file modes", async () => {
    const { cp } = await import("../../src/commands/cp");
    const local = path.join(tmp, "app");
    await fs.mkdir(path.join(local, "src", "lib"), { recursive: true });
    await fs.writeFile(path.join(local, "package.json"), "{}");
    await fs.writeFile(path.join(local, "src", "lib", "a.ts"), "export {}");
    await fs.writeFile(path.join(local, "run.sh"), "#!/bin/sh", { mode: 0o755 });

    await cmd.run(cp, ["-r", local, "sbx:/vercel/sandbox/app", ...scopeArgs]);
    expect(process.exitCode).toBeUndefined();
    expect(
      await fs.readFile(path.join(remoteRoot, "vercel/sandbox/app/src/lib/a.ts"), "utf8"),
    ).toBe("export {}");
    expect(
      (await fs.stat(path.join(remoteRoot, "vercel/sandbox/app/run.sh"))).mode & 0o777,
    ).toBe(0o755);

    const back = path.join(tmp, "back");
    await cmd.run(cp, ["-r", "sbx:/vercel/sandbox/app", back, ...scopeArgs]);
    expect(process.exitCode).toBeUndefined();
    expect(await fs.readFile(path.join(back, "src", "lib", "a.ts"), "utf8")).toBe("export {}");
    expect(await fs.readFile(path.join(back, "package.json"), "utf8")).toBe("{}");
  });

  test("copy without -r on a local directory fails with a hint", async () => {
    const { cp } = await import("../../src/commands/cp");
    const local = path.join(tmp, "dir");
    await fs.mkdir(local);
    await cmd.run(cp, [local, "sbx:/app", ...scopeArgs]);
    expect(process.exitCode).toBe(1);
    expect(sandbox.writeFiles).not.toHaveBeenCalled();
  });

  test("copy -r of a single remote file falls back to a file copy", async () => {
    const { cp } = await import("../../src/commands/cp");
    await fs.mkdir(path.join(remoteRoot, "app"));
    await fs.writeFile(path.join(remoteRoot, "app", "out.txt"), "result");
    const dest = path.join(tmp, "out.txt");
    await cmd.run(cp, ["-r", "sbx:/app/out.txt", dest, ...scopeArgs]);
    expect(await fs.readFile(dest, "utf8")).toBe("result");
  });

  test("read prints the raw file to stdout", async () => {
    const { read } = await import("../../src/commands/read");
    await fs.writeFile(path.join(remoteRoot, "hello.txt"), "hello\nworld\n");
    const chunks: Buffer[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any, ...rest: any[]) => {
      chunks.push(Buffer.from(chunk));
      const cb = rest.find((r) => typeof r === "function");
      cb?.();
      return true;
    });
    await cmd.run(read, ["sbx:/hello.txt", ...scopeArgs]);
    expect(Buffer.concat(chunks).toString()).toBe("hello\nworld\n");
  });

  test("read of a missing file exits non-zero", async () => {
    const { read } = await import("../../src/commands/read");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await cmd.run(read, ["sbx:/nope.txt", ...scopeArgs]);
    expect(process.exitCode).toBe(1);
  });

  test("write stores stdin with the requested mode", async () => {
    const { write } = await import("../../src/commands/write");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stdin = Readable.from([Buffer.from("#!/bin/sh\necho hi\n")]);
    vi.spyOn(process, "stdin", "get").mockReturnValue(stdin as any);
    await cmd.run(write, ["sbx:/bin/hi.sh", "--mode", "755", ...scopeArgs]);
    expect(await fs.readFile(path.join(remoteRoot, "bin", "hi.sh"), "utf8")).toBe(
      "#!/bin/sh\necho hi\n",
    );
    expect((await fs.stat(path.join(remoteRoot, "bin", "hi.sh"))).mode & 0o777).toBe(0o755);
  });
});
