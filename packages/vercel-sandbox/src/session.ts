import type { SandboxMetaData, SandboxRouteData } from "./api-client";
import type { Writable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import type { APIClient } from "./api-client";
import { Command, CommandFinished } from "./command";
import { Snapshot } from "./snapshot";
import { consumeReadable } from "./utils/consume-readable";
import type {
    NetworkPolicy,
    NetworkPolicyRule,
    NetworkTransformer,
} from "./network-policy";
import { convertSandbox, type ConvertedSandbox } from "./utils/convert-sandbox";

export type { NetworkPolicy, NetworkPolicyRule, NetworkTransformer };

/** @inline */
export interface RunCommandParams {
  /**
   * The command to execute
   */
  cmd: string;
  /**
   * Arguments to pass to the command
   */
  args?: string[];
  /**
   * Working directory to execute the command in
   */
  cwd?: string;
  /**
   * Environment variables to set for this command
   */
  env?: Record<string, string>;
  /**
   * If true, execute this command with root privileges. Defaults to false.
   */
  sudo?: boolean;
  /**
   * If true, the command will return without waiting for `exitCode`
   */
  detached?: boolean;
  /**
   * A `Writable` stream where `stdout` from the command will be piped
   */
  stdout?: Writable;
  /**
   * A `Writable` stream where `stderr` from the command will be piped
   */
  stderr?: Writable;
  /**
   * An AbortSignal to cancel the command execution
   */
  signal?: AbortSignal;
}

/**
 * A Session represents a running VM instance within a named {@link Sandbox}.
 * It exposes all methods to interact with the VM: running commands,
 * reading/writing files, managing network policies, and creating snapshots.
 *
 * Obtain a session via {@link Sandbox.currentSession}.
 */
export class Session {
  private readonly client: APIClient;

  /**
   * Routes from ports to subdomains.
   * @hidden
   */
  public readonly routes: SandboxRouteData[];

  /**
   * Internal metadata about the current session.
   */
  private session: ConvertedSandbox;

  /**
   * Unique ID of this session.
   */
  public get sandboxId(): string {
    return this.session.id;
  }

  public get interactivePort(): number | undefined {
    return this.session.interactivePort ?? undefined;
  }

  /**
   * The status of this session.
   */
  public get status(): SandboxMetaData["status"] {
    return this.session.status;
  }

  /**
   * The creation date of this session.
   */
  public get createdAt(): Date {
    return new Date(this.session.createdAt);
  }

  /**
   * The timeout of this session in milliseconds.
   */
  public get timeout(): number {
    return this.session.timeout;
  }

  /**
   * The network policy of this session.
   */
  public get networkPolicy(): NetworkPolicy | undefined {
    return this.session.networkPolicy;
  }

  /**
   * If the session was created from a snapshot, the ID of that snapshot.
   */
  public get sourceSnapshotId(): string | undefined {
    return this.session.sourceSnapshotId;
  }

  /**
   * The amount of CPU used by the session. Only reported once the VM is stopped.
   */
  public get activeCpuUsageMs(): number | undefined {
    return this.session.activeCpuDurationMs;
  }

  /**
   * The amount of network data used by the session. Only reported once the VM is stopped.
   */
  public get networkTransfer(): {ingress: number, egress: number} | undefined {
    return this.session.networkTransfer;
  }

  constructor({
    client,
    routes,
    session,
  }: {
    client: APIClient;
    routes: SandboxRouteData[];
    session: SandboxMetaData;
  }) {
    this.client = client;
    this.routes = routes;
    this.session = convertSandbox(session);
  }

  /**
   * Get a previously run command by its ID.
   *
   * @param cmdId - ID of the command to retrieve
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A {@link Command} instance representing the command
   */
  async getCommand(
    cmdId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Command> {
    const command = await this.client.getCommand({
      sandboxId: this.session.id,
      cmdId,
      signal: opts?.signal,
    });

    return new Command({
      client: this.client,
      sandboxId: this.session.id,
      cmd: command.json.command,
    });
  }

  /**
   * Start executing a command in this session.
   *
   * @param command - The command to execute.
   * @param args - Arguments to pass to the command.
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the command execution.
   * @returns A {@link CommandFinished} result once execution is done.
   */
  async runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<CommandFinished>;

  /**
   * Start executing a command in detached mode.
   *
   * @param params - The command parameters.
   * @returns A {@link Command} instance for the running command.
   */
  async runCommand(
    params: RunCommandParams & { detached: true },
  ): Promise<Command>;

  /**
   * Start executing a command in this session.
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
    return typeof commandOrParams === "string"
      ? this._runCommand({ cmd: commandOrParams, args, signal: opts?.signal })
      : this._runCommand(commandOrParams);
  }

  /**
   * Internal helper to start a command in the session.
   *
   * @param params - Command execution parameters.
   * @returns A {@link Command} or {@link CommandFinished}, depending on `detached`.
   * @internal
   */
  async _runCommand(params: RunCommandParams) {
    const wait = params.detached ? false : true;
    const getLogs = (command: Command) => {
      if (params.stdout || params.stderr) {
        (async () => {
          try {
            for await (const log of command.logs({ signal: params.signal })) {
              if (log.stream === "stdout") {
                params.stdout?.write(log.data);
              } else if (log.stream === "stderr") {
                params.stderr?.write(log.data);
              }
            }
          } catch (err) {
            if (params.signal?.aborted) {
              return;
            }
            throw err;
          }
        })();
      }
    };

    if (wait) {
      const commandStream = await this.client.runCommand({
        sandboxId: this.session.id,
        command: params.cmd,
        args: params.args ?? [],
        cwd: params.cwd,
        env: params.env ?? {},
        sudo: params.sudo ?? false,
        wait: true,
        signal: params.signal,
      });

      const command = new Command({
        client: this.client,
        sandboxId: this.session.id,
        cmd: commandStream.command,
      });

      getLogs(command);

      const finished = await commandStream.finished;
      return new CommandFinished({
        client: this.client,
        sandboxId: this.session.id,
        cmd: finished,
        exitCode: finished.exitCode ?? 0,
      });
    }

    const commandResponse = await this.client.runCommand({
      sandboxId: this.session.id,
      command: params.cmd,
      args: params.args ?? [],
      cwd: params.cwd,
      env: params.env ?? {},
      sudo: params.sudo ?? false,
      signal: params.signal,
    });

    const command = new Command({
      client: this.client,
      sandboxId: this.session.id,
      cmd: commandResponse.json.command,
    });

    getLogs(command);

    return command;
  }

  /**
   * Create a directory in the filesystem of this session.
   *
   * @param path - Path of the directory to create
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   */
  async mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void> {
    await this.client.mkDir({
      sandboxId: this.session.id,
      path: path,
      signal: opts?.signal,
    });
  }

  /**
   * Read a file from the filesystem of this session as a stream.
   *
   * @param file - File to read, with path and optional cwd
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves to a ReadableStream containing the file contents, or null if file not found
   */
  async readFile(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null> {
    return this.client.readFile({
      sandboxId: this.session.id,
      path: file.path,
      cwd: file.cwd,
      signal: opts?.signal,
    });
  }

  /**
   * Read a file from the filesystem of this session as a Buffer.
   *
   * @param file - File to read, with path and optional cwd
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves to the file contents as a Buffer, or null if file not found
   */
  async readFileToBuffer(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null> {
    const stream = await this.client.readFile({
      sandboxId: this.session.id,
      path: file.path,
      cwd: file.cwd,
      signal: opts?.signal,
    });

    if (stream === null) {
      return null;
    }

    return consumeReadable(stream);
  }

  /**
   * Download a file from the session to the local filesystem.
   *
   * @param src - Source file on the session, with path and optional cwd
   * @param dst - Destination file on the local machine, with path and optional cwd
   * @param opts - Optional parameters.
   * @param opts.mkdirRecursive - If true, create parent directories for the destination if they don't exist.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns The absolute path to the written file, or null if the source file was not found
   */
  async downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null> {
    if (!src?.path) {
      throw new Error("downloadFile: source path is required");
    }

    if (!dst?.path) {
      throw new Error("downloadFile: destination path is required");
    }

    const stream = await this.client.readFile({
      sandboxId: this.session.id,
      path: src.path,
      cwd: src.cwd,
      signal: opts?.signal,
    });

    if (stream === null) {
      return null;
    }

    try {
      const dstPath = resolve(dst.cwd ?? "", dst.path);
      if (opts?.mkdirRecursive) {
        await mkdir(dirname(dstPath), { recursive: true });
      }
      await pipeline(stream, createWriteStream(dstPath), {
        signal: opts?.signal,
      });
      return dstPath;
    } finally {
      stream.destroy();
    }
  }

  /**
   * Write files to the filesystem of this session.
   * Defaults to writing to /vercel/sandbox unless an absolute path is specified.
   * Writes files using the `vercel-sandbox` user.
   *
   * @param files - Array of files with path and stream/buffer contents
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves when the files are written
   */
  async writeFiles(
    files: { path: string; content: Buffer }[],
    opts?: { signal?: AbortSignal },
  ) {
    return this.client.writeFiles({
      sandboxId: this.session.id,
      cwd: this.session.cwd,
      extractDir: "/",
      files: files,
      signal: opts?.signal,
    });
  }

  /**
   * Get the public domain of a port of this session.
   *
   * @param p - Port number to resolve
   * @returns A full domain (e.g. `https://subdomain.vercel.run`)
   * @throws If the port has no associated route
   */
  domain(p: number): string {
    const route = this.routes.find(({ port }) => port === p);
    if (route) {
      return `https://${route.subdomain}.vercel.run`;
    } else {
      throw new Error(`No route for port ${p}`);
    }
  }

  /**
   * Stop this session.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @param opts.blocking - If true, poll until the session has fully stopped and return the final state.
   * @returns The session metadata at the time the stop was acknowledged, or after fully stopped if `blocking` is true.
   */
  async stop(opts?: { signal?: AbortSignal; blocking?: boolean }): Promise<ConvertedSandbox> {
    const response = await this.client.stopSandbox({
      sandboxId: this.session.id,
      signal: opts?.signal,
      blocking: opts?.blocking,
    });
    this.session = convertSandbox(response.json.sandbox);
    return this.session;
  }

  /**
   * Update the network policy for this session.
   *
   * @param networkPolicy - The new network policy to apply.
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves when the network policy is updated.
   *
   * @example
   * // Restrict to specific domains
   * await session.updateNetworkPolicy({
   *   allow: ["*.npmjs.org", "github.com"],
   * });
   *
   * @example
   * // Inject credentials with per-domain transformers
   * await session.updateNetworkPolicy({
   *   allow: {
   *     "ai-gateway.vercel.sh": [{
   *       transform: [{
   *         headers: { authorization: "Bearer ..." }
   *       }]
   *     }],
   *     "*": []
   *   }
   * });
   *
   * @example
   * // Deny all network access
   * await session.updateNetworkPolicy("deny-all");
   */
  async updateNetworkPolicy(
    networkPolicy: NetworkPolicy,
    opts?: { signal?: AbortSignal },
  ): Promise<NetworkPolicy> {
    const response = await this.client.updateNetworkPolicy({
      sandboxId: this.session.id,
      networkPolicy: networkPolicy,
      signal: opts?.signal,
    });

    // Update the internal session metadata with the new network policy
    this.session = convertSandbox(response.json.sandbox);
    return this.session.networkPolicy!;
  }

  /**
   * Extend the timeout of the session by the specified duration.
   *
   * This allows you to extend the lifetime of a session up until the maximum
   * execution timeout for your plan.
   *
   * @param duration - The duration in milliseconds to extend the timeout by
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves when the timeout is extended
   *
   * @example
   * const sandbox = await Sandbox.create({ timeout: ms('10m') });
   * const session = sandbox.currentSession();
   * // Extends timeout by 5 minutes, to a total of 15 minutes.
   * await session.extendTimeout(ms('5m'));
   */
  async extendTimeout(
    duration: number,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const response = await this.client.extendTimeout({
      sandboxId: this.session.id,
      duration,
      signal: opts?.signal,
    });

    // Update the internal session metadata with the new timeout value
    this.session = convertSandbox(response.json.sandbox);
  }

  /**
   * Create a snapshot from this currently running session. New sandboxes can
   * then be created from this snapshot using {@link Sandbox.create}.
   *
   * Note: this session will be stopped as part of the snapshot creation process.
   *
   * @param opts - Optional parameters.
   * @param opts.expiration - Optional expiration time in milliseconds. Use 0 for no expiration at all.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves to the Snapshot instance
   */
  async snapshot(opts?: {
    expiration?: number;
    signal?: AbortSignal;
  }): Promise<Snapshot> {
    const response = await this.client.createSnapshot({
      sandboxId: this.session.id,
      expiration: opts?.expiration,
      signal: opts?.signal,
    });

    this.session = convertSandbox(response.json.sandbox);

    return new Snapshot({
      client: this.client,
      snapshot: response.json.snapshot,
    });
  }
}
