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
    const content = Buffer.from(await this.fs.readFileBuffer(path));
    const encoding = typeof options === "string" ? options : options?.encoding;
    return encoding ? content.toString(encoding) : content;
  }

  async writeFile(
    path: string,
    data: WriteFileData,
    _options?: { encoding?: BufferEncoding; signal?: AbortSignal } | BufferEncoding,
  ): Promise<void> {
    await this.fs.writeFile(path, data);
  }

  async appendFile(
    path: string,
    data: WriteFileData,
    _options?: { encoding?: BufferEncoding; signal?: AbortSignal } | BufferEncoding,
  ): Promise<void> {
    await this.fs.appendFile(path, data);
  }

  async mkdir(
    path: string,
    options?: { recursive?: boolean; signal?: AbortSignal } | number,
  ): Promise<string | undefined> {
    await this.fs.mkdir(path, typeof options === "number" ? undefined : options);
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
    if (!options?.withFileTypes) return this.fs.readdir(path);
    const entries = await this.fs.readdirWithFileTypes?.(path);
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
    return toNodeStats(await this.fs.stat(path));
  }

  async lstat(path: string, _options?: { signal?: AbortSignal }): Promise<Stats> {
    return toNodeStats(await this.fs.lstat(path));
  }

  async unlink(path: string, _options?: { signal?: AbortSignal }): Promise<void> {
    await this.fs.rm(path);
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    await this.fs.rm(path, options);
  }

  async rmdir(path: string, _options?: { signal?: AbortSignal }): Promise<void> {
    await this.fs.rm(path);
  }

  async rename(
    oldPath: string,
    newPath: string,
    _options?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.fs.mv(oldPath, newPath);
  }

  async copyFile(src: string, dest: string, _options?: { signal?: AbortSignal }): Promise<void> {
    await this.fs.cp(src, dest);
  }

  async access(path: string, _options?: { signal?: AbortSignal }): Promise<void> {
    if (!(await this.fs.exists(path)))
      throw new Error(`ENOENT: no such file or directory, ${path}`);
  }

  async exists(path: string, _options?: { signal?: AbortSignal }): Promise<boolean> {
    return this.fs.exists(path);
  }

  async chmod(
    path: string,
    mode: number | string,
    _options?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.fs.chmod(path, typeof mode === "string" ? Number.parseInt(mode, 8) : mode);
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
    await this.fs.symlink(target, path);
  }

  async readlink(path: string, _options?: { signal?: AbortSignal }): Promise<string> {
    return this.fs.readlink(path);
  }

  async realpath(path: string, _options?: { signal?: AbortSignal }): Promise<string> {
    return this.fs.realpath(path);
  }

  async truncate(path: string, len = 0, _options?: { signal?: AbortSignal }): Promise<void> {
    const current = Buffer.from(await this.fs.readFileBuffer(path));
    const next = Buffer.alloc(len);
    current.copy(next, 0, 0, Math.min(current.length, len));
    await this.fs.writeFile(path, next);
  }

  async mkdtemp(prefix: string, _options?: { signal?: AbortSignal }): Promise<string> {
    const path = `${prefix}${randomUUID().slice(0, 6)}`;
    await this.fs.mkdir(path);
    return path;
  }
}
