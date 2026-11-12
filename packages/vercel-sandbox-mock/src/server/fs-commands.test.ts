import { InMemoryFs } from "just-bash";
import { describe, expect, test } from "vitest";
import { tryFsCommand } from "./fs-commands";

async function makeFs() {
  const fs = new InMemoryFs();
  await fs.mkdir("/dir/sub", { recursive: true });
  await fs.writeFile("/dir/file.txt", "abc");
  await fs.symlink("/dir/file.txt", "/dir/link");
  return fs;
}

describe("tryFsCommand", () => {
  test("returns null for commands it does not intercept", async () => {
    const fs = await makeFs();
    expect(await tryFsCommand(fs, "/", "ls", ["/dir"])).toBeNull();
    expect(await tryFsCommand(fs, "/", "stat", ["/dir/file.txt"])).toBeNull();
    expect(await tryFsCommand(fs, "/", "find", ["/dir"])).toBeNull();
  });

  test("resolves relative paths against cwd", async () => {
    const fs = await makeFs();
    const result = await tryFsCommand(fs, "/dir", "stat", ["-c", "%s", "file.txt"]);
    expect(result?.stdout).toBe("3\n");
  });

  describe("stat -c", () => {
    test("formats size and type bits for a regular file", async () => {
      const fs = await makeFs();
      const result = await tryFsCommand(fs, "/", "stat", ["-L", "-c", "%s|%f", "/dir/file.txt"]);
      expect(result?.exitCode).toBe(0);
      const [size, rawMode] = result!.stdout.trim().split("|");
      expect(Number(size)).toBe(3);
      expect(parseInt(rawMode, 16) & 0o170000).toBe(0o100000);
    });

    test("-L follows symlinks; without it the link itself is reported", async () => {
      const fs = await makeFs();
      const followed = await tryFsCommand(fs, "/", "stat", ["-L", "-c", "%f", "/dir/link"]);
      expect(parseInt(followed!.stdout.trim(), 16) & 0o170000).toBe(0o100000);
      const link = await tryFsCommand(fs, "/", "stat", ["-c", "%f", "/dir/link"]);
      expect(parseInt(link!.stdout.trim(), 16) & 0o170000).toBe(0o120000);
    });

    test("missing paths fail with ENOENT-shaped stderr", async () => {
      const fs = await makeFs();
      const result = await tryFsCommand(fs, "/", "stat", ["-c", "%s", "/nope"]);
      expect(result?.exitCode).toBe(1);
      expect(result?.stderr).toContain("No such file or directory");
    });
  });

  describe("find -printf", () => {
    test("lists entries as name|type", async () => {
      const fs = await makeFs();
      const result = await tryFsCommand(fs, "/", "find", [
        "/dir",
        "-maxdepth",
        "1",
        "-printf",
        "%f|%y\\n",
      ]);
      const lines = result!.stdout.trim().split("\n").sort();
      expect(lines).toEqual(["file.txt|f", "link|l", "sub|d"]);
    });

    test("empty directories produce empty stdout", async () => {
      const fs = await makeFs();
      const result = await tryFsCommand(fs, "/", "find", ["/dir/sub", "-printf", "%f|%y\\n"]);
      expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    });

    test("missing paths fail", async () => {
      const fs = await makeFs();
      expect((await tryFsCommand(fs, "/", "find", ["/nope", "-printf", "%f\\n"]))?.exitCode).toBe(1);
    });
  });

  test("truncate shrinks and zero-extends files, creating them if missing", async () => {
    const fs = await makeFs();
    await tryFsCommand(fs, "/", "truncate", ["-s", "2", "/dir/file.txt"]);
    expect(await fs.readFile("/dir/file.txt", "utf8")).toBe("ab");
    await tryFsCommand(fs, "/", "truncate", ["-s", "4", "/dir/file.txt"]);
    expect(Buffer.from(await fs.readFileBuffer("/dir/file.txt"))).toEqual(
      Buffer.from([0x61, 0x62, 0x00, 0x00]),
    );
    await tryFsCommand(fs, "/", "truncate", ["-s", "1", "/dir/new"]);
    expect(await fs.exists("/dir/new")).toBe(true);
  });

  test("mktemp replaces the XXXXXX suffix and creates the directory", async () => {
    const fs = await makeFs();
    const a = (await tryFsCommand(fs, "/", "mktemp", ["-d", "/tmp/x-XXXXXX"]))!.stdout.trim();
    const b = (await tryFsCommand(fs, "/", "mktemp", ["-d", "/tmp/x-XXXXXX"]))!.stdout.trim();
    expect(a).toMatch(/^\/tmp\/x-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
    expect(await fs.exists(a)).toBe(true);
  });

  test("realpath resolves symlinks and fails on missing paths", async () => {
    const fs = await makeFs();
    expect((await tryFsCommand(fs, "/", "realpath", ["/dir/link"]))?.stdout).toBe(
      "/dir/file.txt\n",
    );
    expect((await tryFsCommand(fs, "/", "realpath", ["/nope"]))?.exitCode).toBe(1);
  });

  describe("mv -T", () => {
    test("replaces an empty directory instead of moving into it", async () => {
      const fs = await makeFs();
      await fs.mkdir("/dir/target");
      const result = await tryFsCommand(fs, "/", "mv", ["-T", "/dir/sub", "/dir/target"]);
      expect(result?.exitCode).toBe(0);
      expect(await fs.exists("/dir/sub")).toBe(false);
      expect(await fs.readdir("/dir/target")).toEqual([]);
    });

    test("renames and overwrites files", async () => {
      const fs = await makeFs();
      await fs.writeFile("/dir/other.txt", "xyz");
      await tryFsCommand(fs, "/", "mv", ["-T", "/dir/other.txt", "/dir/file.txt"]);
      expect(await fs.readFile("/dir/file.txt", "utf8")).toBe("xyz");
      await tryFsCommand(fs, "/", "mv", ["-T", "/dir/file.txt", "/dir/new.txt"]);
      expect(await fs.readFile("/dir/new.txt", "utf8")).toBe("xyz");
    });

    test("fails like GNU mv when the destination cannot be replaced", async () => {
      const fs = await makeFs();
      await fs.writeFile("/dir/sub/f", "x");
      await fs.mkdir("/dir/empty");
      const notEmpty = await tryFsCommand(fs, "/", "mv", ["-T", "/dir/empty", "/dir/sub"]);
      expect(notEmpty?.stderr).toContain("Directory not empty");
      const fileOverDir = await tryFsCommand(fs, "/", "mv", ["-T", "/dir/file.txt", "/dir/empty"]);
      expect(fileOverDir?.stderr).toContain("with non-directory");
      const dirOverFile = await tryFsCommand(fs, "/", "mv", ["-T", "/dir/empty", "/dir/file.txt"]);
      expect(dirOverFile?.stderr).toContain("with directory");
      const missing = await tryFsCommand(fs, "/", "mv", ["-T", "/nope", "/dir/x"]);
      expect(missing?.stderr).toContain("No such file or directory");
      expect(await fs.readFile("/dir/sub/f", "utf8")).toBe("x");
    });
  });

  test("test -e reports existence via exit code", async () => {
    const fs = await makeFs();
    expect((await tryFsCommand(fs, "/", "test", ["-e", "/dir/file.txt"]))?.exitCode).toBe(0);
    expect((await tryFsCommand(fs, "/", "test", ["-e", "/nope"]))?.exitCode).toBe(1);
  });
});
