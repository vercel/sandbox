import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { listLocalEntries } from "../../src/util/file-transfer";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    get: mockGet,
    create: vi.fn(),
    fork: vi.fn(),
    list: vi.fn(),
  },
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
      async (
        files: { path: string; content: string | Uint8Array; mode?: number }[],
      ) => {
        for (const file of files) {
          await fs.mkdir(path.dirname(resolve(file.path)), { recursive: true });
          await fs.writeFile(resolve(file.path), file.content);
          if (file.mode !== undefined)
            await fs.chmod(resolve(file.path), file.mode);
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
    fs: {
      mkdir: async (p: string, opts?: { recursive?: boolean }) =>
        fs.mkdir(resolve(p), { recursive: opts?.recursive }),
      chmod: async (p: string, mode: number) => fs.chmod(resolve(p), mode),
      symlink: async (target: string, p: string) =>
        fs.symlink(target, resolve(p)),
    },
    runCommand: async (command: string, args: string[]) => {
      expect(command).toBe("find");
      const [target, flag, format] = args;
      expect([flag, format]).toEqual(["-printf", "%y\\0%P\\0%m\\0%l\\0"]);
      const root = resolve(target);
      const rootStat = await fs.lstat(root).catch(() => null);
      if (!rootStat) {
        return {
          exitCode: 1,
          stdout: async () => "",
          stderr: async () => `find: ${target}: No such file or directory`,
        };
      }
      const entries = rootStat.isDirectory()
        ? await listLocalEntries(root)
        : [];
      const metadata = [
        {
          type: rootStat.isFile()
            ? "file"
            : rootStat.isDirectory()
              ? "directory"
              : "symlink",
          rel: "",
          mode: rootStat.mode & 0o777,
          target: rootStat.isSymbolicLink() ? await fs.readlink(root) : "",
        },
        ...entries,
      ];
      const stdout = metadata
        .map((entry) => {
          const kind =
            entry.type === "file"
              ? "f"
              : entry.type === "directory"
                ? "d"
                : "l";
          const target = entry.type === "symlink" ? entry.target : "";
          return [kind, entry.rel, entry.mode.toString(8), target, ""].join(
            "\0",
          );
        })
        .join("");
      return {
        exitCode: 0,
        stdout: async () => stdout,
        stderr: async () => "",
      };
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

  test("copy -r preserves empty directories, symlinks, and modes", async () => {
    const { cp } = await import("../../src/commands/cp");
    const local = path.join(tmp, "app");
    await fs.mkdir(path.join(local, "src", "lib"), { recursive: true });
    await fs.mkdir(path.join(local, "empty"));
    await fs.mkdir(path.join(local, "private"), { mode: 0o750 });
    await fs.writeFile(path.join(local, "package.json"), "{}");
    await fs.writeFile(path.join(local, "src", "lib", "a.ts"), "export {}");
    await fs.writeFile(path.join(local, "run.sh"), "#!/bin/sh", {
      mode: 0o755,
    });
    await fs.symlink(
      "../package.json",
      path.join(local, "src", "package-link"),
    );

    await cmd.run(cp, ["-r", local, "sbx:/vercel/sandbox/app", ...scopeArgs]);
    expect(process.exitCode).toBeUndefined();
    expect(
      await fs.readFile(
        path.join(remoteRoot, "vercel/sandbox/app/src/lib/a.ts"),
        "utf8",
      ),
    ).toBe("export {}");
    expect(
      (await fs.stat(path.join(remoteRoot, "vercel/sandbox/app/run.sh"))).mode &
        0o777,
    ).toBe(0o755);
    expect(
      (await fs.stat(path.join(remoteRoot, "vercel/sandbox/app/private")))
        .mode & 0o777,
    ).toBe(0o750);
    expect(
      (
        await fs.stat(path.join(remoteRoot, "vercel/sandbox/app/empty"))
      ).isDirectory(),
    ).toBe(true);
    expect(
      await fs.readlink(
        path.join(remoteRoot, "vercel/sandbox/app/src/package-link"),
      ),
    ).toBe("../package.json");

    const back = path.join(tmp, "back");
    await cmd.run(cp, ["-r", "sbx:/vercel/sandbox/app", back, ...scopeArgs]);
    expect(process.exitCode).toBeUndefined();
    expect(
      await fs.readFile(path.join(back, "src", "lib", "a.ts"), "utf8"),
    ).toBe("export {}");
    expect(await fs.readFile(path.join(back, "package.json"), "utf8")).toBe(
      "{}",
    );
    expect((await fs.stat(path.join(back, "run.sh"))).mode & 0o777).toBe(0o755);
    expect((await fs.stat(path.join(back, "private"))).mode & 0o777).toBe(
      0o750,
    );
    expect((await fs.stat(path.join(back, "empty"))).isDirectory()).toBe(true);
    expect(await fs.readlink(path.join(back, "src", "package-link"))).toBe(
      "../package.json",
    );
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

  test("copy -r preserves the mode of a single local file", async () => {
    const { cp } = await import("../../src/commands/cp");
    const local = path.join(tmp, "run.sh");
    await fs.writeFile(local, "#!/bin/sh\necho hi\n", { mode: 0o755 });

    await cmd.run(cp, ["-r", local, "sbx:/bin/run.sh", ...scopeArgs]);

    expect(
      (await fs.stat(path.join(remoteRoot, "bin/run.sh"))).mode & 0o777,
    ).toBe(0o755);
  });

  test("copy -r rejects symlinked local destination directories", async () => {
    const { cp } = await import("../../src/commands/cp");
    await fs.mkdir(path.join(remoteRoot, "app", "sub"), { recursive: true });
    await fs.writeFile(
      path.join(remoteRoot, "app", "sub", "payload.txt"),
      "remote payload",
    );
    const dest = path.join(tmp, "back");
    const outside = path.join(tmp, "outside");
    await fs.mkdir(dest);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(dest, "sub"));

    await expect(
      cmd.run(cp, ["-r", "sbx:/app", dest, ...scopeArgs]),
    ).rejects.toThrow(/symbolic link/);
    await expect(
      fs.readFile(path.join(outside, "payload.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("read prints the raw file to stdout", async () => {
    const { read } = await import("../../src/commands/read");
    await fs.writeFile(path.join(remoteRoot, "hello.txt"), "hello\nworld\n");
    const chunks: Buffer[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk: any, ...rest: any[]) => {
        chunks.push(Buffer.from(chunk));
        const cb = rest.find((r) => typeof r === "function");
        cb?.();
        return true;
      },
    );
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
    expect(
      await fs.readFile(path.join(remoteRoot, "bin", "hi.sh"), "utf8"),
    ).toBe("#!/bin/sh\necho hi\n");
    expect(
      (await fs.stat(path.join(remoteRoot, "bin", "hi.sh"))).mode & 0o777,
    ).toBe(0o755);
  });
});
