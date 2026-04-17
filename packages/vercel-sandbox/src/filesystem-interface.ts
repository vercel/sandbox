import type { Dirent, Stats } from "fs";

/**
 * File content can be text or bytes.
 */
export type FileContent = string | Buffer | Uint8Array;

/**
 * Options for reading files.
 */
export type EncodingOption =
  | { encoding?: BufferEncoding | null; signal?: AbortSignal }
  | BufferEncoding
  | null;

/**
 * Options for creating directories.
 */
export interface MkdirOptions {
  recursive?: boolean;
  signal?: AbortSignal;
}

/**
 * Options for removing files/directories.
 */
export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
  signal?: AbortSignal;
}

export interface SignalOptions {
  signal?: AbortSignal;
}

/**
 * Base filesystem contract for sandbox filesystem backends.
 *
 * The shape is intentionally close to just-bash's `IFileSystem`, while
 * preserving this package's current `node:fs/promises`-style methods.
 */
export interface IFileSystem {
  readFile(
    path: string,
    options?: { encoding?: null; signal?: AbortSignal } | null,
  ): Promise<Buffer>;
  readFile(
    path: string,
    options:
      | {
          encoding: BufferEncoding;
          signal?: AbortSignal;
        }
      | BufferEncoding,
  ): Promise<string>;
  readFile(path: string, options?: EncodingOption): Promise<Buffer | string>;

  writeFile(
    path: string,
    content: FileContent,
    options?:
      | {
          encoding?: BufferEncoding;
          signal?: AbortSignal;
        }
      | BufferEncoding,
  ): Promise<void>;
  appendFile(
    path: string,
    content: FileContent,
    options?:
      | {
          encoding?: BufferEncoding;
          signal?: AbortSignal;
        }
      | BufferEncoding,
  ): Promise<void>;

  exists(path: string, options?: SignalOptions): Promise<boolean>;
  stat(path: string, options?: SignalOptions): Promise<Stats>;
  lstat(path: string, options?: SignalOptions): Promise<Stats>;

  mkdir(path: string, options?: MkdirOptions | number): Promise<string | undefined>;
  readdir(
    path: string,
    options?: { signal?: AbortSignal; withFileTypes?: false },
  ): Promise<string[]>;
  readdir(
    path: string,
    options: { signal?: AbortSignal; withFileTypes: true },
  ): Promise<Dirent[]>;
  readdir(
    path: string,
    options?: { signal?: AbortSignal; withFileTypes?: boolean },
  ): Promise<string[] | Dirent[]>;

  rm(path: string, options?: RmOptions): Promise<void>;
  rmdir(path: string, options?: SignalOptions): Promise<void>;
  unlink(path: string, options?: SignalOptions): Promise<void>;

  rename(oldPath: string, newPath: string, options?: SignalOptions): Promise<void>;
  copyFile(src: string, dest: string, options?: SignalOptions): Promise<void>;

  access(path: string, options?: SignalOptions): Promise<void>;
  chmod(path: string, mode: number | string, options?: SignalOptions): Promise<void>;
  chown(
    path: string,
    uid: number,
    gid: number,
    options?: SignalOptions,
  ): Promise<void>;

  symlink(target: string, path: string, options?: SignalOptions): Promise<void>;
  readlink(path: string, options?: SignalOptions): Promise<string>;
  realpath(path: string, options?: SignalOptions): Promise<string>;

  truncate(path: string, len?: number, options?: SignalOptions): Promise<void>;
  mkdtemp(prefix: string, options?: SignalOptions): Promise<string>;
}
