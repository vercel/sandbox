import { Readable } from "stream";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import type { Sandbox } from "./sandbox.js";
import type { RunCommandParams } from "./session.js";
import type { Command, CommandFinished } from "./command.js";
import type { ExecutionContext } from "./execution-context.js";
import { validateName } from "./utils/validate-name.js";

/**
 * Group that owns every user's home directory (and any directory the SDK
 * creates inside it). The sandbox's HTTP file API runs as `vercel-sandbox`,
 * so directories must stay group-owned by it — and mode `770` — for
 * {@link SandboxUser.writeFiles} to be able to traverse and write into them
 * while other users remain locked out.
 */
const SANDBOX_GROUP = "vercel-sandbox";

/**
 * A user context within a sandbox.
 *
 * All file and command operations default to running as this user.
 * Created via {@link Sandbox.createUser} or {@link Sandbox.asUser}.
 *
 * @hideconstructor
 */
export class SandboxUser implements ExecutionContext {
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
    // `root`'s home is `/root`, not `/home/root`; every other user's home
    // follows the `/home/<username>` convention.
    this.homeDir = username === "root" ? "/root" : `/home/${username}`;
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

    const cwd = params.cwd ?? this.homeDir;

    // Run as the target user via `sudo -u`, changing into `cwd` first.
    //
    // We can't set the directory via the sandbox API's `cwd` (the backend cd's
    // there before exec, and SUID binaries like sudo cannot start from a `770`
    // home dir), nor via `sudo --chdir` (the sandbox's sudoers policy forbids
    // the `-D` option). Instead we cd inside a `bash -c` wrapper.
    //
    // `cwd`, the command, its args, and any `env KEY=VAL` are passed as
    // separate positional parameters to `bash -c` (`$1` is `cwd`; `$@` after
    // the shift is the command). Because they are argv elements rather than
    // text spliced into the script, they are never re-parsed by the shell —
    // injection-safe by construction.
    return {
      cmd: "sudo",
      args: [
        "-u",
        this.username,
        "--",
        "bash",
        "-c",
        'cd "$1" || exit 1; shift; exec "$@"',
        "bash", // $0 placeholder for `bash -c`
        cwd,
        ...envArgs,
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
    opts?: { signal?: AbortSignal; timeoutMs?: number },
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
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Command | CommandFinished> {
    if (typeof commandOrParams === "string") {
      const wrapped = this.buildUserCommand({
        cmd: commandOrParams,
        args,
      });
      // Don't pass cwd to the sandbox API — the bash -c wrapper cd's for us.
      // Don't pass sudo: true — vercel-sandbox already has sudo privileges.
      return this.sandbox.runCommand({
        ...wrapped,
        signal: opts?.signal,
        timeoutMs: opts?.timeoutMs,
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
      // Don't pass cwd — the bash -c wrapper cd's for us (see buildUserCommand)
      // Don't pass sudo: true — vercel-sandbox already has sudo privileges
      // env is already baked into the wrapped command via `env KEY=VAL`
      detached: params.detached,
      stdout: params.stdout,
      stderr: params.stderr,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
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
    files: { path: string; content: string | Uint8Array; mode?: number }[],
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

    const paths = absoluteFiles.map((f) => f.path);
    if (paths.length === 0) return;

    // The files themselves belong to the user outright.
    await this.chownOrThrow(
      paths,
      `${this.username}:${this.username}`,
      opts?.signal,
    );

    // Any directories the write implicitly created (e.g. `data/` in
    // `data/config.json`) are owned by vercel-sandbox. Hand them to the user
    // but keep them group-owned by vercel-sandbox with mode 770 — matching the
    // home dir — so the HTTP API can still traverse and write into them later.
    const dirs = this.ancestorDirsUnderHome(paths);
    if (dirs.length > 0) {
      await this.chownOrThrow(
        dirs,
        `${this.username}:${SANDBOX_GROUP}`,
        opts?.signal,
      );
      await this.chmodOrThrow(dirs, "770", opts?.signal);
    }
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
    // `"use step"`: touches a Node built-in (`stream`), which the @workflow
    // compiler only permits inside step functions (matches Session.readFile).
    "use step";
    const buffer = await this.catAsUser(file, opts);
    return buffer === null ? null : Readable.from([buffer]);
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
    return this.catAsUser(file, opts);
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
    // `"use step"`: touches Node built-ins (`fs`, `path`), which the @workflow
    // compiler only permits inside step functions (matches Session.downloadFile).
    "use step";
    const buffer = await this.catAsUser(src, opts);
    if (buffer === null) return null;

    const dstPath = resolve(dst.cwd ?? "", dst.path);
    if (opts?.mkdirRecursive) {
      await mkdir(dirname(dstPath), { recursive: true });
    }
    await writeFile(dstPath, buffer, { signal: opts?.signal });
    return dstPath;
  }

  /**
   * Read a file as this user and return its bytes, or null if it does not
   * exist.
   *
   * Reads via `sudo -u <user> base64` rather than the HTTP file API: the API
   * runs as `vercel-sandbox` and cannot read files this user has kept private
   * (e.g. mode `600`), whereas reading as the user honours the user's own
   * permissions. The payload is base64-encoded because the command output
   * channel is UTF-8 only and would otherwise corrupt binary files.
   */
  private async catAsUser(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null> {
    const path = file.path.startsWith("/")
      ? file.path
      : `${file.cwd ?? this.homeDir}/${file.path}`;
    const result = await this.runCommand({
      cmd: "base64",
      args: [path],
      signal: opts?.signal,
    });
    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      if (/No such file or directory/i.test(stderr)) return null;
      throw new Error(`Failed to read ${path}: ${stderr}`);
    }
    return Buffer.from(await result.stdout(), "base64");
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
    // Own the created directory plus any parents the mkdir created under the
    // home dir. Group-owned by vercel-sandbox with mode 770 so the HTTP file
    // API can write into it (see SANDBOX_GROUP).
    const dirs = [absPath, ...this.ancestorDirsUnderHome([absPath])];
    await this.chownOrThrow(
      dirs,
      `${this.username}:${SANDBOX_GROUP}`,
      opts?.signal,
    );
    await this.chmodOrThrow(dirs, "770", opts?.signal);
  }

  /**
   * Run `chown <ownership> <paths...>` as root, throwing on failure.
   */
  private async chownOrThrow(
    paths: string[],
    ownership: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const chown = await this.sandbox.runCommand({
      cmd: "chown",
      args: [ownership, ...paths],
      sudo: true,
      signal,
    });
    if (chown.exitCode !== 0) {
      const stderr = await chown.stderr();
      throw new Error(
        `Failed to set ownership on ${paths.join(", ")}: ${stderr}`,
      );
    }
  }

  /**
   * Run `chmod <mode> <paths...>` as root, throwing on failure.
   */
  private async chmodOrThrow(
    paths: string[],
    mode: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const chmod = await this.sandbox.runCommand({
      cmd: "chmod",
      args: [mode, ...paths],
      sudo: true,
      signal,
    });
    if (chmod.exitCode !== 0) {
      const stderr = await chmod.stderr();
      throw new Error(
        `Failed to set permissions on ${paths.join(", ")}: ${stderr}`,
      );
    }
  }

  /**
   * Given absolute leaf paths, return the directories strictly between this
   * user's home directory and each leaf. The home dir itself is excluded, as
   * are any paths that fall outside the home dir.
   */
  private ancestorDirsUnderHome(paths: string[]): string[] {
    const dirs = new Set<string>();
    const homePrefix = `${this.homeDir}/`;
    for (const p of paths) {
      let dir = p.slice(0, p.lastIndexOf("/"));
      while (dir.length > this.homeDir.length && dir.startsWith(homePrefix)) {
        dirs.add(dir);
        dir = dir.slice(0, dir.lastIndexOf("/"));
      }
    }
    return [...dirs];
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
