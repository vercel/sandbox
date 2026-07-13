import { randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import type { IFileSystem } from "just-bash";

type WriteFileData = string | Buffer | Uint8Array;
type VirtualStats = Awaited<ReturnType<IFileSystem["stat"]>>;

function toNodeStats(stats: VirtualStats): Stats {
  const timestamp = stats.mtime;
  return {
    dev: 0,
    ino: 0,
    mode: stats.mode,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    size: stats.size,
    blksize: 4096,
    blocks: Math.ceil(stats.size / 512),
    atimeMs: timestamp.getTime(),
    mtimeMs: timestamp.getTime(),
    ctimeMs: timestamp.getTime(),
    birthtimeMs: timestamp.getTime(),
    atime: timestamp,
    mtime: timestamp,
    ctime: timestamp,
    birthtime: timestamp,
    isFile: () => stats.isFile,
    isDirectory: () => stats.isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => stats.isSymbolicLink,
    isFIFO: () => false,
    isSocket: () => false,
  } as Stats;
}

function fsError(
  code: string,
  message: string,
  syscall: string,
  path: string,
): Error & { code: string; syscall: string; path: string } {
  const err = new Error(`${code}: ${message}, ${syscall} '${path}'`) as Error & {
    code: string;
    syscall: string;
    path: string;
  };
  err.code = code;
  err.syscall = syscall;
  err.path = path;
  return err;
}

// just-bash throws plain Errors with node-style messages ("ENOENT: no such
// file or directory, open '/x'") but without the `code`/`syscall`/`path`
// properties node:fs errors carry. Attach them so `err.code === "ENOENT"`
// checks behave like they do against the real sandbox.
function withCode<T>(syscall: string, path: string, promise: Promise<T>): Promise<T> {
  return promise.catch((cause: unknown) => {
    if (cause instanceof Error && !("code" in cause)) {
      const code = /^(E[A-Z]+):/.exec(cause.message)?.[1];
      if (code) Object.assign(cause, { code, syscall, path });
    }
    throw cause;
  });
}

/** A node:fs/promises-compatible facade over just-bash's virtual filesystem. */
export class FileSystem {
  constructor(private readonly fs: IFileSystem) {}

  async readFile(
    path: string,
    options?: { encoding?: null; signal?: AbortSignal } | null,
  ): Promise<Buffer>;
  async readFile(
    path: string,
    options: { encoding: BufferEncoding; signal?: AbortSignal } | BufferEncoding,
  ): Promise<string>;
  async readFile(
    path: string,
    options?: { encoding?: BufferEncoding | null; signal?: AbortSignal } | BufferEncoding | null,
  ): Promise<Buffer | string> {
    const content = Buffer.from(await withCode("open", path, this.fs.readFileBuffer(path)));
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? content.toString(encoding) : content;
  }

  async writeFile(
    path: string,
    data: WriteFileData,
    _options?: { encoding?: BufferEncoding; signal?: AbortSignal } | BufferEncoding,
  ): Promise<void> {
    await withCode("open", path, this.fs.writeFile(path, data));
  }

  async appendFile(
    path: string,
    data: WriteFileData,
    _options?: { encoding?: BufferEncoding; signal?: AbortSignal } | BufferEncoding,
  ): Promise<void> {
    await withCode("open", path, this.fs.appendFile(path, data));
  }

  async mkdir(
    path: string,
    options?: { recursive?: boolean; signal?: AbortSignal } | number,
  ): Promise<string | undefined> {
    await withCode(
      "mkdir",
      path,
      this.fs.mkdir(path, typeof options === "number" ? undefined : options),
    );
    return undefined;
  }

  async readdir(
    path: string,
    options?: { signal?: AbortSignal; withFileTypes?: false },
  ): Promise<string[]>;
  async readdir(
    path: string,
    options: { signal?: AbortSignal; withFileTypes: true },
  ): Promise<Dirent[]>;
  async readdir(
    path: string,
    options?: { signal?: AbortSignal; withFileTypes?: boolean },
  ): Promise<string[] | Dirent[]> {
    if (!options?.withFileTypes) return withCode("scandir", path, this.fs.readdir(path));
    const entries = await withCode(
      "scandir",
      path,
      this.fs.readdirWithFileTypes?.(path) ?? Promise.resolve(undefined),
    );
    if (!entries) return [];
    return entries.map(
      (entry) =>
        ({
          name: entry.name,
          parentPath: path,
          path,
          isFile: () => entry.isFile,
          isDirectory: () => entry.isDirectory,
          isSymbolicLink: () => entry.isSymbolicLink,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        }) as Dirent,
    );
  }

  async stat(path: string, _options?: { signal?: AbortSignal }): Promise<Stats> {
    return toNodeStats(await withCode("stat", path, this.fs.stat(path)));
  }

  async lstat(path: string, _options?: { signal?: AbortSignal }): Promise<Stats> {
    return toNodeStats(await withCode("lstat", path, this.fs.lstat(path)));
  }

  async unlink(path: string, _options?: { signal?: AbortSignal }): Promise<void> {
    await withCode("unlink", path, this.fs.rm(path));
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    await withCode("rm", path, this.fs.rm(path, options));
  }

  async rmdir(path: string, _options?: { signal?: AbortSignal }): Promise<void> {
    await withCode("rmdir", path, this.fs.rm(path));
  }

  async rename(
    oldPath: string,
    newPath: string,
    _options?: { signal?: AbortSignal },
  ): Promise<void> {
    await withCode("rename", oldPath, this.fs.mv(oldPath, newPath));
  }

  async copyFile(src: string, dest: string, _options?: { signal?: AbortSignal }): Promise<void> {
    await withCode("copyfile", src, this.fs.cp(src, dest));
  }

  async access(path: string, _options?: { signal?: AbortSignal }): Promise<void> {
    if (!(await this.fs.exists(path)))
      throw fsError("ENOENT", "no such file or directory", "access", path);
  }

  async exists(path: string, _options?: { signal?: AbortSignal }): Promise<boolean> {
    return this.fs.exists(path);
  }

  async chmod(
    path: string,
    mode: number | string,
    _options?: { signal?: AbortSignal },
  ): Promise<void> {
    await withCode(
      "chmod",
      path,
      this.fs.chmod(path, typeof mode === "string" ? Number.parseInt(mode, 8) : mode),
    );
  }

  async chown(
    path: string,
    _uid: number,
    _gid: number,
    _options?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.access(path);
  }

  async symlink(target: string, path: string, _options?: { signal?: AbortSignal }): Promise<void> {
    await withCode("symlink", path, this.fs.symlink(target, path));
  }

  async readlink(path: string, _options?: { signal?: AbortSignal }): Promise<string> {
    return withCode("readlink", path, this.fs.readlink(path));
  }

  async realpath(path: string, _options?: { signal?: AbortSignal }): Promise<string> {
    return withCode("realpath", path, this.fs.realpath(path));
  }

  async truncate(path: string, len = 0, _options?: { signal?: AbortSignal }): Promise<void> {
    const current = Buffer.from(await withCode("open", path, this.fs.readFileBuffer(path)));
    const next = Buffer.alloc(len);
    current.copy(next, 0, 0, Math.min(current.length, len));
    await withCode("open", path, this.fs.writeFile(path, next));
  }

  async mkdtemp(prefix: string, _options?: { signal?: AbortSignal }): Promise<string> {
    const path = `${prefix}${randomUUID().slice(0, 6)}`;
    await withCode("mkdir", path, this.fs.mkdir(path));
    return path;
  }
}
