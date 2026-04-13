import * as fs from "fs";

// UV_DIRENT_* constants exist at runtime but aren't in @types/node
const UV_DIRENT_FILE = 1;
const UV_DIRENT_DIR = 2;
const UV_DIRENT_LINK = 3;
const UV_DIRENT_FIFO = 4;
const UV_DIRENT_SOCKET = 5;
const UV_DIRENT_CHAR = 6;
const UV_DIRENT_BLOCK = 7;

type EncodingOption =
  | { encoding?: BufferEncoding | null; signal?: AbortSignal }
  | BufferEncoding
  | null;

type WriteFileData = string | Buffer | Uint8Array;

interface MkdirOptions {
  recursive?: boolean;
  signal?: AbortSignal;
}

interface RmOptions {
  recursive?: boolean;
  force?: boolean;
  signal?: AbortSignal;
}

function fsError(
  code: string,
  message: string,
  syscall: string,
  path: string,
): Error & { code: string; syscall: string; path: string } {
  const err = new Error(
    `${code}: ${message}, ${syscall} '${path}'`,
  ) as Error & {
    code: string;
    syscall: string;
    path: string;
  };
  err.code = code;
  err.syscall = syscall;
  err.path = path;
  return err;
}

interface SandboxHandle {
  readFileToBuffer(
    file: { path: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null>;
  writeFiles(
    files: { path: string; content: Buffer }[],
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
  mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void>;
  runCommand(
    cmd: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<{
    exitCode: number;
    stdout(opts?: { signal?: AbortSignal }): Promise<string>;
    stderr(opts?: { signal?: AbortSignal }): Promise<string>;
  }>;
}

function parseEncoding(options?: EncodingOption): {
  encoding: BufferEncoding | null;
  signal?: AbortSignal;
} {
  if (options === null || options === undefined) {
    return { encoding: null };
  }
  if (typeof options === "string") {
    return { encoding: options };
  }
  return { encoding: options.encoding ?? null, signal: options.signal };
}

function parseStat(stdout: string): fs.Stats {
  // The Stats constructor and Dirent constructor exist at runtime but are marked
  // private in @types/node. We cast to the actual runtime signatures.
  const StatsConstructor = fs.Stats as unknown as new (
    dev: number,
    mode: number,
    nlink: number,
    uid: number,
    gid: number,
    rdev: number,
    blksize: number,
    ino: number,
    size: number,
    blocks: number,
    atimeMs: number,
    mtimeMs: number,
    ctimeMs: number,
    birthtimeMs: number,
  ) => fs.Stats;

  // Format: size|rawModeHex|uid|gid|atimeMs|mtimeMs|ctimeMs|birthtimeMs|nlink|ino|dev|blksize|blocks
  const parts = stdout.trim().split("|");

  return new StatsConstructor(
    parseInt(parts[10]!, 10), // dev
    parseInt(parts[1]!, 16), // mode (raw mode from %f, hex)
    parseInt(parts[8]!, 10), // nlink
    parseInt(parts[2]!, 10), // uid
    parseInt(parts[3]!, 10), // gid
    0, // rdev
    parseInt(parts[11]!, 10), // blksize
    parseInt(parts[9]!, 10), // ino
    parseInt(parts[0]!, 10), // size
    parseInt(parts[12]!, 10), // blocks
    parseFloat(parts[4]!) * 1000, // atimeMs
    parseFloat(parts[5]!) * 1000, // mtimeMs
    parseFloat(parts[6]!) * 1000, // ctimeMs
    parseFloat(parts[7]!) * 1000, // birthtimeMs
  );
}

function parseDirent(stdout: string, path: string): fs.Dirent {
  const parts = stdout.trim().split("|");
  const name = parts[0];
  const type = parts[1];

  if (!name) {
    throw fsError("ENOENT", "no such file or directory", "readdir", path);
  }

  if (!type) {
    throw new Error(`Invalid dirent type: ${type}`);
  }

  const DirentConstructor = fs.Dirent as unknown as new (
    name: string,
    type: number,
    path: string,
  ) => fs.Dirent;

  const direntType = FIND_TYPE_TO_DIRENT[type] ?? UV_DIRENT_FILE;
  return new DirentConstructor(name, direntType, path);
}

// %f = raw mode in hex, includes file type bits so Stats.isFile()/isDirectory()/etc. work
const STAT_FORMAT = "%s|%f|%u|%g|%X|%Y|%Z|%W|%h|%i|%d|%B|%b";

const FIND_TYPE_TO_DIRENT: Record<string, number> = {
  f: UV_DIRENT_FILE,
  d: UV_DIRENT_DIR,
  l: UV_DIRENT_LINK,
  b: UV_DIRENT_BLOCK,
  c: UV_DIRENT_CHAR,
  p: UV_DIRENT_FIFO,
  s: UV_DIRENT_SOCKET,
};

export class FileSystem {
  /** @internal */
  private sandbox: SandboxHandle;

  /** @internal */
  constructor(sandbox: SandboxHandle) {
    this.sandbox = sandbox;
  }

  /**
   * Read the entire contents of a file.
   *
   * @param path - Path to the file
   * @param options - Encoding or options object. If encoding is specified, returns a string; otherwise returns a Buffer.
   */
  async readFile(
    path: string,
    options?: { encoding?: null; signal?: AbortSignal } | null,
  ): Promise<Buffer>;
  async readFile(
    path: string,
    options:
      | { encoding: BufferEncoding; signal?: AbortSignal }
      | BufferEncoding,
  ): Promise<string>;
  async readFile(
    path: string,
    options?: EncodingOption,
  ): Promise<Buffer | string> {
    "use step";
    const { encoding, signal } = parseEncoding(options);
    const buffer = await this.sandbox.readFileToBuffer({ path }, { signal });
    if (buffer === null) {
      throw fsError("ENOENT", "no such file or directory", "open", path);
    }
    return encoding ? buffer.toString(encoding) : buffer;
  }

  /**
   * Write data to a file, replacing the file if it already exists.
   *
   * @param path - Path to the file
   * @param data - The data to write
   * @param options - Write options
   */
  async writeFile(
    path: string,
    data: WriteFileData,
    options?:
      | { encoding?: BufferEncoding; signal?: AbortSignal }
      | BufferEncoding,
  ): Promise<void> {
    "use step";
    const { encoding, signal } =
      typeof options === "string"
        ? { encoding: options, signal: undefined }
        : { encoding: options?.encoding, signal: options?.signal };
    let content: Buffer;
    if (typeof data === "string") {
      content = Buffer.from(data, encoding ?? "utf8");
    } else if (Buffer.isBuffer(data)) {
      content = data;
    } else {
      content = Buffer.from(data);
    }
    await this.sandbox.writeFiles([{ path, content }], { signal });
  }

  /**
   * Append data to a file, creating the file if it does not yet exist.
   *
   * @param path - Path to the file
   * @param data - The data to append
   * @param options - Write options
   */
  async appendFile(
    path: string,
    data: WriteFileData,
    options?:
      | { encoding?: BufferEncoding; signal?: AbortSignal }
      | BufferEncoding,
  ): Promise<void> {
    "use step";
    const { encoding, signal } =
      typeof options === "string"
        ? { encoding: options, signal: undefined }
        : { encoding: options?.encoding, signal: options?.signal };
    let appendContent: Buffer;
    if (typeof data === "string") {
      appendContent = Buffer.from(data, encoding ?? "utf8");
    } else if (Buffer.isBuffer(data)) {
      appendContent = data;
    } else {
      appendContent = Buffer.from(data);
    }

    const existing = await this.sandbox.readFileToBuffer({ path }, { signal });
    const content =
      existing !== null
        ? Buffer.concat([existing, appendContent])
        : appendContent;
    await this.sandbox.writeFiles([{ path, content }], { signal });
  }

  /**
   * Create a directory.
   *
   * @param path - Path of the directory to create
   * @param options - Options for directory creation
   */
  async mkdir(
    path: string,
    options?: MkdirOptions | number,
  ): Promise<string | undefined> {
    "use step";
    const opts =
      typeof options === "number" ? { recursive: false } : (options ?? {});
    if (opts.recursive) {
      const result = await this.sandbox.runCommand("mkdir", ["-p", path], {
        signal: opts.signal,
      });
      if (result.exitCode !== 0) {
        const stderr = await result.stderr();
        throw fsError(
          "EACCES",
          stderr.trim() || "permission denied",
          "mkdir",
          path,
        );
      }
      return undefined;
    }
    await this.sandbox.mkDir(path, { signal: opts.signal });
    return undefined;
  }

  /**
   * Read the contents of a directory.
   *
   * @param path - Path to the directory
   * @param options - Options. When `withFileTypes` is true, returns `Dirent` objects.
   */
  async readdir(
    path: string,
    options?: { signal?: AbortSignal; withFileTypes?: false },
  ): Promise<string[]>;
  async readdir(
    path: string,
    options: { signal?: AbortSignal; withFileTypes: true },
  ): Promise<fs.Dirent[]>;
  async readdir(
    path: string,
    options?: { signal?: AbortSignal; withFileTypes?: boolean },
  ): Promise<string[] | fs.Dirent[]> {
    "use step";
    if (options?.withFileTypes) {
      // Use find to get name and type in one pass
      const result = await this.sandbox.runCommand(
        "find",
        [path, "-maxdepth", "1", "-mindepth", "1", "-printf", "%f|%y\\n"],
        { signal: options?.signal },
      );
      if (result.exitCode !== 0) {
        const stderr = await result.stderr();
        if (stderr.includes("No such file or directory")) {
          throw fsError("ENOENT", "no such file or directory", "scandir", path);
        }
        throw fsError("EACCES", stderr.trim(), "scandir", path);
      }
      const stdout = await result.stdout();
      const lines = stdout.trim().split("\n").filter(Boolean);

      return lines.map((line) => parseDirent(line, path));
    }

    const result = await this.sandbox.runCommand("ls", ["-1", path], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "scandir", path);
      }
      throw fsError("EACCES", stderr.trim(), "scandir", path);
    }
    const stdout = await result.stdout();
    return stdout.trim().split("\n").filter(Boolean);
  }

  /**
   * Get file status. Follows symbolic links.
   *
   * @param path - Path to the file
   * @param options - Options
   */
  async stat(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<fs.Stats> {
    "use step";
    const result = await this.sandbox.runCommand(
      "stat",
      ["-L", "-c", STAT_FORMAT, path],
      { signal: options?.signal },
    );
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "stat", path);
      }
      throw fsError("EACCES", stderr.trim(), "stat", path);
    }
    return parseStat(await result.stdout());
  }

  /**
   * Get file status. Does not follow symbolic links.
   *
   * @param path - Path to the file
   * @param options - Options
   */
  async lstat(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<fs.Stats> {
    "use step";
    const result = await this.sandbox.runCommand(
      "stat",
      ["-c", STAT_FORMAT, path],
      { signal: options?.signal },
    );
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "lstat", path);
      }
      throw fsError("EACCES", stderr.trim(), "lstat", path);
    }
    const stat = await parseStat(await result.stdout());

    return stat;
  }

  /**
   * Remove a file or symbolic link.
   *
   * @param path - Path to the file
   * @param options - Options
   */
  async unlink(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const result = await this.sandbox.runCommand("rm", [path], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "unlink", path);
      }
      throw fsError("EACCES", stderr.trim(), "unlink", path);
    }
  }

  /**
   * Remove files and directories.
   *
   * @param path - Path to remove
   * @param options - Options
   */
  async rm(path: string, options?: RmOptions): Promise<void> {
    "use step";
    const args: string[] = [];
    if (options?.recursive) args.push("-r");
    if (options?.force) args.push("-f");
    args.push(path);

    const result = await this.sandbox.runCommand("rm", args, {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "rm", path);
      }
      throw fsError("EACCES", stderr.trim(), "rm", path);
    }
  }

  /**
   * Remove a directory.
   *
   * @param path - Path to the directory
   * @param options - Options
   */
  async rmdir(path: string, options?: { signal?: AbortSignal }): Promise<void> {
    "use step";
    const result = await this.sandbox.runCommand("rmdir", [path], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "rmdir", path);
      }
      if (stderr.includes("not empty")) {
        throw fsError("ENOTEMPTY", "directory not empty", "rmdir", path);
      }
      throw fsError("EACCES", stderr.trim(), "rmdir", path);
    }
  }

  /**
   * Rename a file or directory.
   *
   * @param oldPath - Current path
   * @param newPath - New path
   * @param options - Options
   */
  async rename(
    oldPath: string,
    newPath: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const result = await this.sandbox.runCommand("mv", [oldPath, newPath], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "rename", oldPath);
      }
      throw fsError("EACCES", stderr.trim(), "rename", oldPath);
    }
  }

  /**
   * Copy a file.
   *
   * @param src - Source path
   * @param dest - Destination path
   * @param options - Options
   */
  async copyFile(
    src: string,
    dest: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const result = await this.sandbox.runCommand("cp", [src, dest], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "copyfile", src);
      }
      throw fsError("EACCES", stderr.trim(), "copyfile", src);
    }
  }

  /**
   * Test whether a file exists and the user has the specified permissions.
   *
   * @param path - Path to the file
   * @param options - Options
   */
  async access(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const result = await this.sandbox.runCommand("test", ["-e", path], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      throw fsError("ENOENT", "no such file or directory", "access", path);
    }
  }

  /**
   * Check if a path exists.
   *
   * This is a convenience method not in `node:fs/promises` but commonly needed.
   *
   * @param path - Path to check
   * @param options - Options
   */
  async exists(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<boolean> {
    const result = await this.sandbox.runCommand("test", ["-e", path], {
      signal: options?.signal,
    });
    return result.exitCode === 0;
  }

  /**
   * Change file mode (permissions).
   *
   * @param path - Path to the file
   * @param mode - File mode (e.g., 0o755 or "755")
   * @param options - Options
   */
  async chmod(
    path: string,
    mode: number | string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const modeStr = typeof mode === "number" ? mode.toString(8) : mode;
    const result = await this.sandbox.runCommand("chmod", [modeStr, path], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "chmod", path);
      }
      throw fsError("EACCES", stderr.trim(), "chmod", path);
    }
  }

  /**
   * Change file owner and group.
   *
   * @param path - Path to the file
   * @param uid - User ID
   * @param gid - Group ID
   * @param options - Options
   */
  async chown(
    path: string,
    uid: number,
    gid: number,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const result = await this.sandbox.runCommand(
      "chown",
      [`${uid}:${gid}`, path],
      { signal: options?.signal },
    );
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "chown", path);
      }
      throw fsError("EACCES", stderr.trim(), "chown", path);
    }
  }

  /**
   * Create a symbolic link.
   *
   * @param target - The target of the symbolic link
   * @param path - The path of the symbolic link to create
   * @param options - Options
   */
  async symlink(
    target: string,
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const result = await this.sandbox.runCommand("ln", ["-s", target, path], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("File exists")) {
        throw fsError("EEXIST", "file already exists", "symlink", path);
      }
      throw fsError("EACCES", stderr.trim(), "symlink", path);
    }
  }

  /**
   * Read the value of a symbolic link.
   *
   * @param path - Path to the symbolic link
   * @param options - Options
   */
  async readlink(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    "use step";
    const result = await this.sandbox.runCommand("readlink", [path], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "readlink", path);
      }
      throw fsError("EINVAL", "invalid argument", "readlink", path);
    }
    return (await result.stdout()).trim();
  }

  /**
   * Resolve the real path of a file (resolving symlinks).
   *
   * @param path - Path to resolve
   * @param options - Options
   */
  async realpath(
    path: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    "use step";
    const result = await this.sandbox.runCommand("realpath", [path], {
      signal: options?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "realpath", path);
      }
      throw fsError("EACCES", stderr.trim(), "realpath", path);
    }
    return (await result.stdout()).trim();
  }

  /**
   * Truncate a file to a specified length.
   *
   * @param path - Path to the file
   * @param len - Length to truncate to (default: 0)
   * @param options - Options
   */
  async truncate(
    path: string,
    len?: number,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const result = await this.sandbox.runCommand(
      "truncate",
      ["-s", String(len ?? 0), path],
      { signal: options?.signal },
    );
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (stderr.includes("No such file or directory")) {
        throw fsError("ENOENT", "no such file or directory", "truncate", path);
      }
      throw fsError("EACCES", stderr.trim(), "truncate", path);
    }
  }

  /**
   * Create a unique temporary directory.
   *
   * @param prefix - The prefix for the temporary directory name
   * @param options - Options
   * @returns The path of the created temporary directory
   */
  async mkdtemp(
    prefix: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    "use step";
    const result = await this.sandbox.runCommand(
      "mktemp",
      ["-d", `${prefix}XXXXXX`],
      { signal: options?.signal },
    );
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      throw fsError("EACCES", stderr.trim(), "mkdtemp", prefix);
    }
    return (await result.stdout()).trim();
  }
}
