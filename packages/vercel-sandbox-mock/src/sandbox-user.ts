import type { Sandbox } from "./sandbox";
import type { Command, CommandFinished } from "./command";
import type { ExecutionContext, RunCommandParams } from "./execution-context";
import { validateName } from "./utils/validate-name";

/**
 * A user context within a sandbox.
 *
 * All file and command operations default to running as this user (relative
 * paths resolve against the user's home directory, and `$USER`/`$HOME` are set
 * accordingly). Created via {@link Sandbox.createUser} or {@link Sandbox.asUser}.
 *
 * Note: `just-bash` has no real Linux users, so this is a best-effort
 * simulation. `whoami` still reports the underlying shell user; assertions that
 * depend on true OS-level user identity or permission isolation only hold
 * against a real sandbox.
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

  readonly #sandbox: Sandbox;

  constructor({ sandbox, username }: { sandbox: Sandbox; username: string }) {
    this.#sandbox = sandbox;
    this.username = username;
    // `root`'s home is `/root`, not `/home/root`; every other user's home
    // follows the `/home/<username>` convention.
    this.homeDir = username === "root" ? "/root" : `/home/${username}`;
  }

  /** Environment variables that identify this user to the command. */
  #userEnv(extra?: Record<string, string>): Record<string, string> {
    return {
      USER: this.username,
      LOGNAME: this.username,
      HOME: this.homeDir,
      ...extra,
    };
  }

  /** Resolve a path relative to this user's home directory. */
  #resolvePath(path: string): string {
    return path.startsWith("/") ? path : `${this.homeDir}/${path}`;
  }

  async runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<CommandFinished>;
  async runCommand(
    params: RunCommandParams & { detached: true },
  ): Promise<Command>;
  async runCommand(params: RunCommandParams): Promise<CommandFinished>;
  async runCommand(
    commandOrParams: string | RunCommandParams,
    args?: string[],
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Command | CommandFinished> {
    if (typeof commandOrParams === "string") {
      return this.#sandbox.runCommand({
        cmd: commandOrParams,
        args,
        cwd: this.homeDir,
        env: this.#userEnv(),
        signal: opts?.signal,
        timeoutMs: opts?.timeoutMs,
      });
    }

    const params = commandOrParams;
    // `sudo: true` means "run as root" — don't scope to this user.
    if (params.sudo) {
      return this.#sandbox.runCommand(
        params as RunCommandParams & { detached: true },
      );
    }

    return this.#sandbox.runCommand({
      ...params,
      cwd: params.cwd ?? this.homeDir,
      env: this.#userEnv(params.env),
    } as RunCommandParams & { detached: true });
  }

  async writeFiles(
    files: { path: string; content: string | Uint8Array; mode?: number }[],
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const resolved = files.map((f) => ({ ...f, path: this.#resolvePath(f.path) }));
    return this.#sandbox.writeFiles(resolved, opts);
  }

  async readFile(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null> {
    return this.#sandbox.readFile(
      { path: this.#resolvePath(file.path), cwd: file.cwd ?? this.homeDir },
      opts,
    );
  }

  async readFileToBuffer(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null> {
    return this.#sandbox.readFileToBuffer(
      { path: this.#resolvePath(file.path), cwd: file.cwd ?? this.homeDir },
      opts,
    );
  }

  async downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null> {
    return this.#sandbox.downloadFile(
      { path: this.#resolvePath(src.path), cwd: src.cwd ?? this.homeDir },
      dst,
      opts,
    );
  }

  async mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void> {
    return this.#sandbox.mkDir(this.#resolvePath(path), opts);
  }

  async addToGroup(
    groupname: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    validateName(groupname, "group name");
    await this.#sandbox.addUserToGroup(this.username, groupname, opts);
  }

  async removeFromGroup(
    groupname: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    validateName(groupname, "group name");
    await this.#sandbox.removeUserFromGroup(this.username, groupname, opts);
  }
}
