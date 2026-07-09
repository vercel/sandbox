import type { RunCommandParams } from "./session.js";
import type { Command, CommandFinished } from "./command.js";

/**
 * The common surface for running commands and performing file operations in
 * a sandbox, regardless of scope.
 *
 * Implemented by {@link Sandbox}, {@link Session}, and {@link SandboxUser},
 * so code can be written against "somewhere to run commands" without caring
 * whether it targets the whole sandbox or a specific user's context.
 *
 * Implementations may scope the operations: for example, {@link SandboxUser}
 * runs commands as its user and resolves relative paths against the user's
 * home directory.
 */
export interface ExecutionContext {
  /**
   * Start executing a command in this context.
   *
   * @param command - The command to execute.
   * @param args - Arguments to pass to the command.
   * @param opts - Optional parameters.
   * @returns A {@link CommandFinished} result once execution is done.
   */
  runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<CommandFinished>;

  /**
   * Start executing a command in this context in detached mode.
   *
   * @param params - The command parameters.
   * @returns A {@link Command} instance for the running command.
   */
  runCommand(params: RunCommandParams & { detached: true }): Promise<Command>;

  /**
   * Start executing a command in this context.
   *
   * @param params - The command parameters.
   * @returns A {@link CommandFinished} result once execution is done.
   */
  runCommand(params: RunCommandParams): Promise<CommandFinished>;

  /**
   * Create a directory in the filesystem of this context.
   *
   * @param path - Path of the directory to create
   * @param opts - Optional parameters.
   */
  mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void>;

  /**
   * Read a file from this context as a stream.
   *
   * @param file - File to read, with path and optional cwd
   * @param opts - Optional parameters.
   * @returns A ReadableStream of the file contents, or null if not found
   */
  readFile(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null>;

  /**
   * Read a file from this context as a Buffer.
   *
   * @param file - File to read, with path and optional cwd
   * @param opts - Optional parameters.
   * @returns The file contents as a Buffer, or null if not found
   */
  readFileToBuffer(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null>;

  /**
   * Download a file from this context to the local filesystem.
   *
   * @param src - Source file in the sandbox
   * @param dst - Destination on the local machine
   * @param opts - Optional parameters.
   * @returns The absolute path to the written file, or null if not found
   */
  downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null>;

  /**
   * Write files to the filesystem of this context.
   *
   * @param files - Array of files with path, content, and optional mode
   * @param opts - Optional parameters.
   */
  writeFiles(
    files: { path: string; content: string | Uint8Array; mode?: number }[],
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
}
