import type { Writable } from "stream";
import type { Sandbox } from "./sandbox.js";
import type { Command, CommandFinished } from "./command.js";
import { validateName } from "./utils/validate-name.js";

/** @inline */
interface RunCommandParams {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
  detached?: boolean;
  stdout?: Writable;
  stderr?: Writable;
  signal?: AbortSignal;
}

/**
 * A user context within a sandbox.
 *
 * All file and command operations default to running as this user.
 * Created via {@link Sandbox.createUser} or {@link Sandbox.asUser}.
 *
 * @hideconstructor
 */
export class SandboxUser {
  /**
   * The Linux username.
   */
  readonly username: string;

  /**
   * The user's home directory (e.g., `/home/alice`).
   */
  readonly homeDir: string;

  private readonly sandbox: Sandbox;

  constructor({
    sandbox,
    username,
  }: {
    sandbox: Sandbox;
    username: string;
  }) {
    this.sandbox = sandbox;
    this.username = username;
    this.homeDir = `/home/${username}`;
  }

  /**
   * Build the wrapped command args to run as this user via `sudo -u`.
   *
   * When `env` is provided, injects `env KEY=VAL ...` so that environment
   * variables survive the `sudo -u` transition.
   */
  private buildUserCommand(params: {
    cmd: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  }): { cmd: string; args: string[] } {
    const envEntries = Object.entries(params.env ?? {});
    const envArgs =
      envEntries.length > 0
        ? ["env", ...envEntries.map(([k, v]) => `${k}=${v}`)]
        : [];

    // We cannot use the API's `cwd` parameter for user home dirs because
    // the backend cd's to `cwd` before exec, and SUID binaries (like sudo)
    // cannot be executed from directories with restricted permissions (770).
    //
    // Instead, we use: sudo -u <user> -- [env K=V...] bash -c 'cd <dir> && exec "$@"' _ <cmd> <args>
    // This pattern:
    // - Uses bash's "$@" to properly handle arguments with spaces
    // - Sets the working directory inside the user's context
    // - Passes env vars via the `env` command before bash
    const cwd = params.cwd ?? this.homeDir;
    return {
      cmd: "sudo",
      args: [
        "-u",
        this.username,
        "--",
        ...envArgs,
        "bash",
        "-c",
        `cd ${cwd} && exec "$@"`,
        "_",
        params.cmd,
        ...(params.args ?? []),
      ],
    };
  }

  /**
   * Resolve a path relative to this user's home directory.
   * Absolute paths are returned as-is.
   */
  private resolvePath(path: string): string {
    return path.startsWith("/") ? path : `${this.homeDir}/${path}`;
  }

  /**
   * Start executing a command as this user.
   *
   * @param command - The command to execute.
   * @param args - Arguments to pass to the command.
   * @param opts - Optional parameters.
   * @returns A {@link CommandFinished} result once execution is done.
   */
  async runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<CommandFinished>;

  /**
   * Start executing a command as this user in detached mode.
   *
   * @param params - The command parameters.
   * @returns A {@link Command} instance for the running command.
   */
  async runCommand(
    params: RunCommandParams & { detached: true },
  ): Promise<Command>;

  /**
   * Start executing a command as this user.
   *
   * @param params - The command parameters.
   * @returns A {@link CommandFinished} result once execution is done.
   */
  async runCommand(params: RunCommandParams): Promise<CommandFinished>;

  async runCommand(
    commandOrParams: string | RunCommandParams,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<Command | CommandFinished> {
    if (typeof commandOrParams === "string") {
      const wrapped = this.buildUserCommand({
        cmd: commandOrParams,
        args,
      });
      // Don't pass cwd to the sandbox API — the bash -c wrapper handles it.
      // Don't pass sudo: true — vercel-sandbox already has sudo privileges.
      return this.sandbox.runCommand({
        ...wrapped,
        signal: opts?.signal,
      });
    }

    const params = commandOrParams;

    // When sudo: true is passed, delegate directly to root (skip user wrapping).
    // Don't default cwd to homeDir — the backend can't exec SUID binaries
    // from directories with restricted permissions.
    if (params.sudo) {
      return this.sandbox.runCommand({
        ...params,
      } as RunCommandParams & { detached: true });
    }

    const wrapped = this.buildUserCommand({
      cmd: params.cmd,
      args: params.args,
      env: params.env,
      cwd: params.cwd,
    });

    return this.sandbox.runCommand({
      cmd: wrapped.cmd,
      args: wrapped.args,
      // Don't pass cwd — bash -c wrapper handles it (see buildUserCommand)
      // Don't pass sudo: true — vercel-sandbox already has sudo privileges
      // env is already baked into the wrapped command via `env KEY=VAL`
      detached: params.detached,
      stdout: params.stdout,
      stderr: params.stderr,
      signal: params.signal,
    } as RunCommandParams & { detached: true });
  }

  /**
   * Write files to this user's home directory (or absolute paths).
   * Files are written via the sandbox HTTP API then chowned to this user.
   *
   * The HTTP API can write to user home dirs because they are group-owned
   * by `vercel-sandbox` with `770` permissions.
   *
   * @param files - Array of files with path, content, and optional mode
   * @param opts - Optional parameters.
   */
  async writeFiles(
    files: { path: string; content: Buffer; mode?: number }[],
    opts?: { signal?: AbortSignal },
  ) {
    // Resolve relative paths to user's home directory
    const absoluteFiles = files.map((f) => ({
      ...f,
      path: this.resolvePath(f.path),
    }));

    // Write via the HTTP API (works because home dirs are group-owned
    // by vercel-sandbox)
    await this.sandbox.writeFiles(absoluteFiles, opts);

    // Chown all written files to this user
    const paths = absoluteFiles.map((f) => f.path);
    await this.sandbox.runCommand({
      cmd: "chown",
      args: [`${this.username}:${this.username}`, ...paths],
      sudo: true,
      signal: opts?.signal,
    });
  }

  /**
   * Read a file from this user's context as a stream.
   *
   * @param file - File to read, with path and optional cwd
   * @param opts - Optional parameters.
   * @returns A ReadableStream of the file contents, or null if not found
   */
  async readFile(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null> {
    return this.sandbox.readFile(
      { path: file.path, cwd: file.cwd ?? this.homeDir },
      opts,
    );
  }

  /**
   * Read a file from this user's context as a Buffer.
   *
   * @param file - File to read, with path and optional cwd
   * @param opts - Optional parameters.
   * @returns The file contents as a Buffer, or null if not found
   */
  async readFileToBuffer(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null> {
    return this.sandbox.readFileToBuffer(
      { path: file.path, cwd: file.cwd ?? this.homeDir },
      opts,
    );
  }

  /**
   * Download a file from this user's context to the local filesystem.
   *
   * @param src - Source file in the sandbox
   * @param dst - Destination on the local machine
   * @param opts - Optional parameters.
   * @returns The absolute path to the written file, or null if not found
   */
  async downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null> {
    return this.sandbox.downloadFile(
      { path: src.path, cwd: src.cwd ?? this.homeDir },
      dst,
      opts,
    );
  }

  /**
   * Create a directory owned by this user.
   *
   * @param path - Path of the directory to create
   * @param opts - Optional parameters.
   */
  async mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void> {
    const absPath = this.resolvePath(path);
    await this.sandbox.mkDir(absPath, opts);
    await this.sandbox.runCommand({
      cmd: "chown",
      args: [`${this.username}:${this.username}`, absPath],
      sudo: true,
      signal: opts?.signal,
    });
    await this.sandbox.runCommand({
      cmd: "chmod",
      args: ["770", absPath],
      sudo: true,
      signal: opts?.signal,
    });
  }

  /**
   * Add this user to a group.
   *
   * @param groupname - Name of the group to join
   * @param opts - Optional parameters.
   */
  async addToGroup(
    groupname: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    validateName(groupname, "group name");
    await this.sandbox.addUserToGroup(this.username, groupname, opts);
  }

  /**
   * Remove this user from a group.
   *
   * @param groupname - Name of the group to leave
   * @param opts - Optional parameters.
   */
  async removeFromGroup(
    groupname: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    validateName(groupname, "group name");
    await this.sandbox.removeUserFromGroup(this.username, groupname, opts);
  }
}
