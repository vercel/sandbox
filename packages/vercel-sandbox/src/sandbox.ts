import type { SandboxMetaData, SandboxRouteData } from "./api-client";
import { type Writable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import { APIClient } from "./api-client";
import { Command, CommandFinished } from "./command";
import { type Credentials, getCredentials } from "./utils/get-credentials";
import { getPrivateParams, WithPrivate } from "./utils/types";
import { WithFetchOptions } from "./api-client/api-client";
import { RUNTIMES } from "./constants";
import { Snapshot } from "./snapshot";
import { consumeReadable } from "./utils/consume-readable";
import {
  toAPINetworkPolicy,
  type NetworkPolicy,
} from "./utils/network-policy";

export type { NetworkPolicy };

/** @inline */
export interface BaseCreateSandboxParams {
  /**
   * The source of the sandbox.
   *
   * Omit this parameter start a sandbox without a source.
   *
   * For git sources:
   * - `depth`: Creates shallow clones with limited commit history (minimum: 1)
   * - `revision`: Clones and checks out a specific commit, branch, or tag
   */
  source?:
    | {
        type: "git";
        url: string;
        depth?: number;
        revision?: string;
      }
    | {
        type: "git";
        url: string;
        username: string;
        password: string;
        depth?: number;
        revision?: string;
      }
    | { type: "tarball"; url: string };
  /**
   * Array of port numbers to expose from the sandbox. Sandboxes can
   * expose up to 4 ports.
   */
  ports?: number[];
  /**
   * Timeout in milliseconds before the sandbox auto-terminates.
   */
  timeout?: number;
  /**
   * Resources to allocate to the sandbox.
   *
   * Your sandbox will get the amount of vCPUs you specify here and
   * 2048 MB of memory per vCPU.
   */
  resources?: { vcpus: number };

  /**
   * The runtime of the sandbox, currently only `node24`, `node22` and `python3.13` are supported.
   * If not specified, the default runtime `node24` will be used.
   */
  runtime?: RUNTIMES | (string & {});

  /**
   * Network policy to define network restrictions for the sandbox.
   * Defaults to full internet access if not specified.
   */
  networkPolicy?: NetworkPolicy;

  /**
   * An AbortSignal to cancel sandbox creation.
   */
  signal?: AbortSignal;
}

export type CreateSandboxParams =
  | BaseCreateSandboxParams
  | (Omit<BaseCreateSandboxParams, "runtime" | "source"> & {
      source: { type: "snapshot"; snapshotId: string };
    });

/** @inline */
interface GetSandboxParams {
  /**
   * Unique identifier of the sandbox.
   */
  sandboxId: string;
  /**
   * An AbortSignal to cancel the operation.
   */
  signal?: AbortSignal;
}

/** @inline */
interface RunCommandParams {
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
 * A Sandbox is an isolated Linux MicroVM to run commands in.
 *
 * Use {@link Sandbox.create} or {@link Sandbox.get} to construct.
 * @hideconstructor
 */
export class Sandbox {
  private readonly client: APIClient;

  /**
   * Routes from ports to subdomains.
  /* @hidden
   */
  public readonly routes: SandboxRouteData[];

  /**
   * Unique ID of this sandbox.
   */
  public get sandboxId(): string {
    return this.sandbox.id;
  }

  public get interactivePort(): number | undefined {
    return this.sandbox.interactivePort ?? undefined;
  }

  /**
   * The status of the sandbox.
   */
  public get status(): SandboxMetaData["status"] {
    return this.sandbox.status;
  }

  /**
   * The creation date of the sandbox.
   */
  public get createdAt(): Date {
    return new Date(this.sandbox.createdAt);
  }

  /**
   * The timeout of the sandbox in milliseconds.
   */
  public get timeout(): number {
    return this.sandbox.timeout;
  }

  /**
   * If the sandbox was created from a snapshot, the ID of that snapshot.
   */
  public get sourceSnapshotId(): string | undefined {
    return this.sandbox.sourceSnapshotId;
  }

  /**
   * Internal metadata about this sandbox.
   */
  private sandbox: SandboxMetaData;

  /**
   * Allow to get a list of sandboxes for a team narrowed to the given params.
   * It returns both the sandboxes and the pagination metadata to allow getting
   * the next page of results.
   */
  static async list(
    params?: Partial<Parameters<APIClient["listSandboxes"]>[0]> &
      Partial<Credentials> &
      WithFetchOptions,
  ) {
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params?.fetch,
    });
    return client.listSandboxes({
      ...credentials,
      ...params,
    });
  }

  /**
   * Create a new sandbox.
   *
   * @param params - Creation parameters and optional credentials.
   * @returns A promise resolving to the created {@link Sandbox}.
   * @example
   * <caption>Create a sandbox and drop it in the end of the block</caption>
   * async function fn() {
   *   await using const sandbox = await Sandbox.create();
   *   // Sandbox automatically stopped at the end of the lexical scope
   * }
   */
  static async create(
    params?: WithPrivate<
      CreateSandboxParams | (CreateSandboxParams & Credentials)
    > &
      WithFetchOptions,
  ): Promise<Sandbox & AsyncDisposable> {
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params?.fetch,
    });

    const privateParams = getPrivateParams(params);
    const sandbox = await client.createSandbox({
      source: params?.source,
      projectId: credentials.projectId,
      ports: params?.ports ?? [],
      timeout: params?.timeout,
      resources: params?.resources,
      runtime: params && "runtime" in params ? params?.runtime : undefined,
      networkPolicy: toAPINetworkPolicy(params?.networkPolicy),
      signal: params?.signal,
      ...privateParams,
    });

    return new DisposableSandbox({
      client,
      sandbox: sandbox.json.sandbox,
      routes: sandbox.json.routes,
    });
  }

  /**
   * Retrieve an existing sandbox.
   *
   * @param params - Get parameters and optional credentials.
   * @returns A promise resolving to the {@link Sandbox}.
   */
  static async get(
    params: WithPrivate<GetSandboxParams | (GetSandboxParams & Credentials)> &
      WithFetchOptions,
  ): Promise<Sandbox> {
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params.fetch,
    });

    const privateParams = getPrivateParams(params);
    const sandbox = await client.getSandbox({
      sandboxId: params.sandboxId,
      signal: params.signal,
      ...privateParams,
    });

    return new Sandbox({
      client,
      sandbox: sandbox.json.sandbox,
      routes: sandbox.json.routes,
    });
  }

  /**
   * Create a new Sandbox instance.
   *
   * @param client - API client used to communicate with the backend
   * @param routes - Port-to-subdomain mappings for exposed ports
   * @param sandboxId - Unique identifier for the sandbox
   */
  constructor({
    client,
    routes,
    sandbox,
  }: {
    client: APIClient;
    routes: SandboxRouteData[];
    sandbox: SandboxMetaData;
  }) {
    this.client = client;
    this.routes = routes;
    this.sandbox = sandbox;
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
      sandboxId: this.sandbox.id,
      cmdId,
      signal: opts?.signal,
    });

    return new Command({
      client: this.client,
      sandboxId: this.sandbox.id,
      cmd: command.json.command,
    });
  }

  /**
   * Start executing a command in this sandbox.
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
   * Start executing a command in this sandbox.
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
   * Internal helper to start a command in the sandbox.
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
    }

    if (wait) {
      const commandStream = await this.client.runCommand({
        sandboxId: this.sandbox.id,
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
        sandboxId: this.sandbox.id,
        cmd: commandStream.command,
      });

      getLogs(command); 

      const finished = await commandStream.finished;
      return new CommandFinished({
        client: this.client,
        sandboxId: this.sandbox.id,
        cmd: finished,
        exitCode: finished.exitCode ?? 0,
      });
    }

    const commandResponse = await this.client.runCommand({
      sandboxId: this.sandbox.id,
      command: params.cmd,
      args: params.args ?? [],
      cwd: params.cwd,
      env: params.env ?? {},
      sudo: params.sudo ?? false,
      signal: params.signal,
    });

    const command = new Command({
      client: this.client,
      sandboxId: this.sandbox.id,
      cmd: commandResponse.json.command,
    });

    getLogs(command);

    return command;
  }

  /**
   * Create a directory in the filesystem of this sandbox.
   *
   * @param path - Path of the directory to create
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   */
  async mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void> {
    await this.client.mkDir({
      sandboxId: this.sandbox.id,
      path: path,
      signal: opts?.signal,
    });
  }

  /**
   * Read a file from the filesystem of this sandbox as a stream.
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
      sandboxId: this.sandbox.id,
      path: file.path,
      cwd: file.cwd,
      signal: opts?.signal,
    });
  }

  /**
   * Read a file from the filesystem of this sandbox as a Buffer.
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
      sandboxId: this.sandbox.id,
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
   * Download a file from the sandbox to the local filesystem.
   *
   * @param src - Source file on the sandbox, with path and optional cwd
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
      sandboxId: this.sandbox.id,
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
      stream.destroy()
    }
  }

  /**
   * Write files to the filesystem of this sandbox.
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
      sandboxId: this.sandbox.id,
      cwd: this.sandbox.cwd,
      extractDir: "/",
      files: files,
      signal: opts?.signal,
    });
  }

  /**
   * Get the public domain of a port of this sandbox.
   *
   * @param p - Port number to resolve
   * @returns A full domain (e.g. `https://subdomain.vercel.run`)
   * @throws If the port has no associated route
   */
  domain(p: number): string {
    const route = this.routes.find(({ port }) => port == p);
    if (route) {
      return `https://${route.subdomain}.vercel.run`;
    } else {
      throw new Error(`No route for port ${p}`);
    }
  }

  /**
   * Stop the sandbox.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves when the sandbox is stopped
   */
  async stop(opts?: { signal?: AbortSignal }) {
    await this.client.stopSandbox({
      sandboxId: this.sandbox.id,
      signal: opts?.signal,
    });
  }

  /**
   * Update the network policy for this sandbox.
   *
   * @param networkPolicy - The new network policy to apply.
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves when the network policy is updated.
   *
   * @example
   * // Restrict to specific domains
   * await sandbox.updateNetworkPolicy({
   *   type: "restricted",
   *   allowedDomains: ["*.npmjs.org", "github.com"],
   * });
   *
   * @example
   * // Deny all network access
   * await sandbox.updateNetworkPolicy({ type: "no-access" });
   */
  async updateNetworkPolicy(
    networkPolicy: NetworkPolicy,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const apiNetworkPolicy = toAPINetworkPolicy(networkPolicy);
    if (!apiNetworkPolicy) {
      throw new Error("Invalid network policy");
    }
    await this.client.updateNetworkPolicy({
      sandboxId: this.sandbox.id,
      networkPolicy: apiNetworkPolicy,
      signal: opts?.signal,
    });
  }

  /**
   * Extend the timeout of the sandbox by the specified duration.
   *
   * This allows you to extend the lifetime of a sandbox up until the maximum
   * execution timeout for your plan.
   *
   * @param duration - The duration in milliseconds to extend the timeout by
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves when the timeout is extended
   *
   * @example
   * const sandbox = await Sandbox.create({ timeout: ms('10m') });
   * // Extends timeout by 5 minutes, to a total of 15 minutes.
   * await sandbox.extendTimeout(ms('5m'));
   */
  async extendTimeout(
    duration: number,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const response = await this.client.extendTimeout({
      sandboxId: this.sandbox.id,
      duration,
      signal: opts?.signal,
    });

    // Update the internal sandbox metadata with the new timeout value
    this.sandbox = response.json.sandbox;
  }

  /**
   * Create a snapshot from this currently running sandbox. New sandboxes can
   * then be created from this snapshot using {@link Sandbox.createFromSnapshot}.
   *
   * Note: this sandbox will be stopped as part of the snapshot creation process.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves to the Snapshot instance
   */
  async snapshot(opts?: { signal?: AbortSignal }): Promise<Snapshot> {
    const response = await this.client.createSnapshot({
      sandboxId: this.sandbox.id,
      signal: opts?.signal,
    });

    this.sandbox = response.json.sandbox;

    return new Snapshot({
      client: this.client,
      snapshot: response.json.snapshot,
    });
  }
}

/**
 * A {@link Sandbox} that can automatically be disposed using a `await using` statement.
 *
 * @example
 * {
 *   await using const sandbox = await Sandbox.create();
 * }
 * // Sandbox is automatically stopped here
 */
class DisposableSandbox extends Sandbox implements AsyncDisposable {
  async [Symbol.asyncDispose]() {
    await this.stop();
  }
}
