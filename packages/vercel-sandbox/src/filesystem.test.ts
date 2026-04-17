import { it, expect, describe, vi, beforeEach } from "vitest";
import type { Stats, Dirent } from "fs";
import { FileSystem } from "./filesystem";

function makeMockSandbox() {
  return {
    readFileToBuffer: vi.fn(),
    writeFiles: vi.fn(),
    mkDir: vi.fn(),
    runCommand: vi.fn(),
  };
}

function mockCommandResult(stdout: string, exitCode = 0, stderr = "") {
  return {
    exitCode,
    stdout: vi.fn().mockResolvedValue(stdout),
    stderr: vi.fn().mockResolvedValue(stderr),
  };
}

describe("FileSystem", () => {
  let sandbox: ReturnType<typeof makeMockSandbox>;
  let fs: FileSystem;

  beforeEach(() => {
    sandbox = makeMockSandbox();
    fs = new FileSystem(sandbox as any);
  });

  describe("readFile", () => {
    it("returns a Buffer when no encoding is specified", async () => {
      sandbox.readFileToBuffer.mockResolvedValue(Buffer.from("hello"));
      const result = await fs.readFile("/test.txt");
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe("hello");
      expect(sandbox.readFileToBuffer).toHaveBeenCalledWith(
        { path: "/test.txt" },
        { signal: undefined },
      );
    });

    it("returns a string when encoding is specified as string", async () => {
      sandbox.readFileToBuffer.mockResolvedValue(Buffer.from("hello"));
      const result = await fs.readFile("/test.txt", "utf8");
      expect(typeof result).toBe("string");
      expect(result).toBe("hello");
    });

    it("returns a string when encoding is specified in options", async () => {
      sandbox.readFileToBuffer.mockResolvedValue(Buffer.from("hello"));
      const result = await fs.readFile("/test.txt", { encoding: "utf8" });
      expect(typeof result).toBe("string");
      expect(result).toBe("hello");
    });

    it("throws ENOENT when file does not exist", async () => {
      sandbox.readFileToBuffer.mockResolvedValue(null);
      await expect(fs.readFile("/missing.txt")).rejects.toMatchObject({
        code: "ENOENT",
        syscall: "open",
        path: "/missing.txt",
      });
    });

    it("passes signal through", async () => {
      const signal = AbortSignal.abort();
      sandbox.readFileToBuffer.mockResolvedValue(Buffer.from("data"));
      await fs.readFile("/test.txt", { signal });
      expect(sandbox.readFileToBuffer).toHaveBeenCalledWith(
        { path: "/test.txt" },
        { signal },
      );
    });
  });

  describe("readFileBuffer", () => {
    it("returns the file content as a Buffer", async () => {
      sandbox.readFileToBuffer.mockResolvedValue(Buffer.from("hello"));
      const result = await fs.readFileBuffer("/test.txt");
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe("hello");
    });
  });

  describe("writeFile", () => {
    it("writes string data as utf8 Buffer", async () => {
      sandbox.writeFiles.mockResolvedValue(undefined);
      await fs.writeFile("/test.txt", "hello");
      expect(sandbox.writeFiles).toHaveBeenCalledWith(
        [{ path: "/test.txt", content: Buffer.from("hello") }],
        { signal: undefined },
      );
    });

    it("writes Buffer data directly", async () => {
      sandbox.writeFiles.mockResolvedValue(undefined);
      const buf = Buffer.from("binary");
      await fs.writeFile("/test.bin", buf);
      expect(sandbox.writeFiles).toHaveBeenCalledWith(
        [{ path: "/test.bin", content: buf }],
        { signal: undefined },
      );
    });

    it("writes Uint8Array data", async () => {
      sandbox.writeFiles.mockResolvedValue(undefined);
      const data = new Uint8Array([1, 2, 3]);
      await fs.writeFile("/test.bin", data);
      const calledContent = sandbox.writeFiles.mock.calls[0][0][0].content;
      expect(Buffer.isBuffer(calledContent)).toBe(true);
      expect([...calledContent]).toEqual([1, 2, 3]);
    });

    it("respects encoding option", async () => {
      sandbox.writeFiles.mockResolvedValue(undefined);
      await fs.writeFile("/test.txt", "data", "utf8");
      expect(sandbox.writeFiles).toHaveBeenCalled();
    });
  });

  describe("appendFile", () => {
    it("appends to existing file", async () => {
      sandbox.readFileToBuffer.mockResolvedValue(Buffer.from("hello "));
      sandbox.writeFiles.mockResolvedValue(undefined);
      await fs.appendFile("/test.txt", "world");
      expect(sandbox.writeFiles).toHaveBeenCalledWith(
        [{ path: "/test.txt", content: Buffer.from("hello world") }],
        { signal: undefined },
      );
    });

    it("creates file if it does not exist", async () => {
      sandbox.readFileToBuffer.mockResolvedValue(null);
      sandbox.writeFiles.mockResolvedValue(undefined);
      await fs.appendFile("/new.txt", "data");
      expect(sandbox.writeFiles).toHaveBeenCalledWith(
        [{ path: "/new.txt", content: Buffer.from("data") }],
        { signal: undefined },
      );
    });
  });

  describe("mkdir", () => {
    it("calls sandbox.mkDir for non-recursive", async () => {
      sandbox.mkDir.mockResolvedValue(undefined);
      await fs.mkdir("/newdir");
      expect(sandbox.mkDir).toHaveBeenCalledWith("/newdir", {
        signal: undefined,
      });
    });

    it("uses mkdir -p for recursive", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.mkdir("/a/b/c", { recursive: true });
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "mkdir",
        ["-p", "/a/b/c"],
        { signal: undefined },
      );
    });
  });

  describe("readdir", () => {
    it("returns list of filenames", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult("file1.txt\nfile2.txt\ndir1\n"),
      );
      const result = await fs.readdir("/mydir");
      expect(result).toEqual(["file1.txt", "file2.txt", "dir1"]);
    });

    it("returns Dirent objects with withFileTypes", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult("file.txt|f\nsubdir|d\nlink|l\n"),
      );
      const result = await fs.readdir("/mydir", { withFileTypes: true });
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("file.txt");
      expect(result[0].isFile()).toBe(true);
      expect(result[0].isDirectory()).toBe(false);
      expect(result[1].name).toBe("subdir");
      expect(result[1].isDirectory()).toBe(true);
      expect(result[2].name).toBe("link");
      expect(result[2].isSymbolicLink()).toBe(true);
    });

    it("throws ENOENT for missing directory", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult(
          "",
          2,
          "ls: cannot access '/missing': No such file or directory",
        ),
      );
      await expect(fs.readdir("/missing")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  describe("readdirWithFileTypes", () => {
    it("returns Dirent entries", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult("file.txt|f\nsubdir|d\n"),
      );
      const result = await fs.readdirWithFileTypes("/mydir");
      expect(result).toHaveLength(2);
      expect(result[0].isFile()).toBe(true);
      expect(result[1].isDirectory()).toBe(true);
    });
  });

  describe("stat", () => {
    it("parses stat output and returns a Stats instance", async () => {
      // Format: size|rawModeHex|uid|gid|atimeS|mtimeS|ctimeS|birthtimeS|nlink|ino|dev|blksize|blocks
      // 0o100755 = 0x81ed in hex for regular file with 755 permissions
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult(
          "1024|81ed|1000|1000|1700000000|1700000001|1700000002|1700000003|1|12345|2049|4096|8",
        ),
      );
      const stats = await fs.stat("/test.txt");
      expect(stats.size).toBe(1024);
      expect(stats.uid).toBe(1000);
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.mtimeMs).toBe(1700000001000);
    });

    it("correctly identifies directories", async () => {
      // 0o40755 = 0x41ed in hex for directory with 755 permissions
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult(
          "4096|41ed|0|0|1700000000|1700000001|1700000002|0|2|100|2049|4096|8",
        ),
      );
      const stats = await fs.stat("/mydir");
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isFile()).toBe(false);
    });

    it("throws ENOENT for missing file", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult(
          "",
          1,
          "stat: cannot statx '/missing': No such file or directory",
        ),
      );
      await expect(fs.stat("/missing")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  describe("lstat", () => {
    it("does not follow symlinks", async () => {
      // 0o120777 = 0xa1ff in hex for symbolic link
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult(
          "0|a1ff|1000|1000|1700000000|1700000001|1700000002|0|1|12345|2049|4096|0",
        ),
      );
      const stats = await fs.lstat("/mylink");
      expect(stats.isSymbolicLink()).toBe(true);
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "stat",
        ["-c", expect.any(String), "/mylink"],
        expect.any(Object),
      );
      // Ensure -L is NOT used for lstat
      const args = sandbox.runCommand.mock.calls[0][1];
      expect(args).not.toContain("-L");
    });
  });

  describe("unlink", () => {
    it("removes a file", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.unlink("/test.txt");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "rm",
        ["/test.txt"],
        expect.any(Object),
      );
    });

    it("throws ENOENT for missing file", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult(
          "",
          1,
          "rm: cannot remove '/missing': No such file or directory",
        ),
      );
      await expect(fs.unlink("/missing")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  describe("rm", () => {
    it("removes with recursive and force flags", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.rm("/dir", { recursive: true, force: true });
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "rm",
        ["-r", "-f", "/dir"],
        expect.any(Object),
      );
    });
  });

  describe("rmdir", () => {
    it("removes an empty directory", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.rmdir("/emptydir");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "rmdir",
        ["/emptydir"],
        expect.any(Object),
      );
    });

    it("throws ENOTEMPTY for non-empty directory", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult(
          "",
          1,
          "rmdir: failed to remove '/dir': Directory not empty",
        ),
      );
      await expect(fs.rmdir("/dir")).rejects.toMatchObject({
        code: "ENOTEMPTY",
      });
    });
  });

  describe("rename", () => {
    it("renames a file", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.rename("/old.txt", "/new.txt");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "mv",
        ["/old.txt", "/new.txt"],
        expect.any(Object),
      );
    });

    it("aliases mv to rename", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.mv("/old.txt", "/new.txt");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "mv",
        ["/old.txt", "/new.txt"],
        expect.any(Object),
      );
    });
  });

  describe("copyFile", () => {
    it("copies a file", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.copyFile("/src.txt", "/dst.txt");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "cp",
        ["/src.txt", "/dst.txt"],
        expect.any(Object),
      );
    });

    it("aliases cp to copyFile", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.cp("/src.txt", "/dst.txt");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "cp",
        ["/src.txt", "/dst.txt"],
        expect.any(Object),
      );
    });
  });

  describe("access", () => {
    it("resolves when file exists", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult("", 0));
      await expect(fs.access("/existing")).resolves.toBeUndefined();
    });

    it("throws ENOENT when file does not exist", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult("", 1));
      await expect(fs.access("/missing")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  describe("exists", () => {
    it("returns true when file exists", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult("", 0));
      expect(await fs.exists("/existing")).toBe(true);
    });

    it("returns false when file does not exist", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult("", 1));
      expect(await fs.exists("/missing")).toBe(false);
    });
  });

  describe("chmod", () => {
    it("changes mode with numeric mode", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.chmod("/test.txt", 0o755);
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "chmod",
        ["755", "/test.txt"],
        expect.any(Object),
      );
    });

    it("changes mode with string mode", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.chmod("/test.txt", "644");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "chmod",
        ["644", "/test.txt"],
        expect.any(Object),
      );
    });
  });

  describe("symlink", () => {
    it("creates a symbolic link", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.symlink("/target", "/link");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "ln",
        ["-s", "/target", "/link"],
        expect.any(Object),
      );
    });

    it("throws EEXIST when link already exists", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult(
          "",
          1,
          "ln: failed to create symbolic link '/link': File exists",
        ),
      );
      await expect(fs.symlink("/target", "/link")).rejects.toMatchObject({
        code: "EEXIST",
      });
    });
  });

  describe("readlink", () => {
    it("reads a symlink target", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult("/target\n"));
      const result = await fs.readlink("/link");
      expect(result).toBe("/target");
    });
  });

  describe("realpath", () => {
    it("resolves the real path", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult("/real/path\n"));
      const result = await fs.realpath("/some/link");
      expect(result).toBe("/real/path");
    });
  });

  describe("truncate", () => {
    it("truncates a file to specified length", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.truncate("/test.txt", 100);
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "truncate",
        ["-s", "100", "/test.txt"],
        expect.any(Object),
      );
    });

    it("truncates to 0 by default", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.truncate("/test.txt");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "truncate",
        ["-s", "0", "/test.txt"],
        expect.any(Object),
      );
    });
  });

  describe("mkdtemp", () => {
    it("creates a temp directory", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockCommandResult("/tmp/prefix123456\n"),
      );
      const result = await fs.mkdtemp("/tmp/prefix");
      expect(result).toBe("/tmp/prefix123456");
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "mktemp",
        ["-d", "/tmp/prefixXXXXXX"],
        expect.any(Object),
      );
    });
  });

  describe("chown", () => {
    it("changes file owner", async () => {
      sandbox.runCommand.mockResolvedValue(mockCommandResult(""));
      await fs.chown("/test.txt", 1000, 1000);
      expect(sandbox.runCommand).toHaveBeenCalledWith(
        "chown",
        ["1000:1000", "/test.txt"],
        expect.any(Object),
      );
    });
  });
});
