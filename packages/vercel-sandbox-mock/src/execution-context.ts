import type { Writable } from "node:stream";
import type { Command, CommandFinished } from "./command";

export type RunCommandParams = {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
  detached?: boolean;
  stdout?: Writable;
  stderr?: Writable;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * The common surface for running commands and performing file operations in
 * a sandbox, regardless of scope.
 *
 * Implemented by {@link Sandbox}, {@link Session}, and {@link SandboxUser},
 * so code can be written against "somewhere to run commands" without caring
 * whether it targets the whole sandbox or a specific user's context.
 */
export interface ExecutionContext {
  runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<CommandFinished>;
  runCommand(params: RunCommandParams & { detached: true }): Promise<Command>;
  runCommand(params: RunCommandParams): Promise<CommandFinished>;

  mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void>;

  readFile(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null>;

  readFileToBuffer(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null>;

  downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null>;

  writeFiles(
    files: { path: string; content: string | Uint8Array; mode?: number }[],
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
}
