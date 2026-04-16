import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import type { Writable } from "stream";
import { pipeline } from "stream/promises";
import type { WithFetchOptions } from "./api-client/api-client.js";
import type { SandboxMetaData, SandboxRouteData } from "./api-client/index.js";
import { APIClient } from "./api-client/index.js";
import { Command, CommandFinished } from "./command.js";
import type { RUNTIMES } from "./constants.js";
import type {
  NetworkPolicy,
  NetworkPolicyRule,
  NetworkTransformer,
} from "./network-policy.js";
import { Snapshot } from "./snapshot.js";
import { consumeReadable } from "./utils/consume-readable.js";
import { type Credentials, getCredentials } from "./utils/get-credentials.js";
import {
  type SandboxSnapshot,
  toSandboxSnapshot,
} from "./utils/sandbox-snapshot.js";
import {
  getPrivateParams,
  getSpanLinkPrivateParams,
  type WithPrivate,
} from "./utils/types.js";
import { FileSystem } from "./filesystem.js";

export type { NetworkPolicy, NetworkPolicyRule, NetworkTransformer };

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
   * Default environment variables for the sandbox.
   * These are inherited by all commands unless overridden with
   * the `env` option in `runCommand`.
   *
   * @example
   * const sandbox = await Sandbox.create({
   *   env: { NODE_ENV: "production", API_KEY: "secret" },
   * });
   * // All commands will have NODE_ENV and API_KEY set
   * await sandbox.runCommand("node", ["app.js"]);
   */
  env?: Record<string, string>;

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

/**
 * Serialized representation of a Sandbox for @workflow/serde.
 */
export interface SerializedSandbox {
  metadata: SandboxSnapshot;
  routes: SandboxRouteData[];
  spanLinkPrivateParams?: Record<string, unknown>;
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

// ============================================================================
// Sandbox class
// ============================================================================

/**
 * A Sandbox is an isolated Linux MicroVM to run commands in.
 *
 * Use {@link Sandbox.create} or {@link Sandbox.get} to construct.
 * @hideconstructor
 */
export class Sandbox {
  private _client: APIClient | null = null;
  private spanLinkPrivateParams: Record<string, unknown>;

  /**
   * Lazily resolve credentials and construct an API client.
   * This is used in step contexts where the Sandbox was deserialized
   * without a client (e.g. when crossing workflow/step boundaries).
   * Uses getCredentials() which resolves from OIDC or env vars.
   * @internal
   */
  private async ensureClient(): Promise<APIClient> {
    "use step";
    if (this._client) return this._client;
    const credentials = await getCredentials();
    this._client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
    });
    return this._client;
  }

  /**
   * Routes from ports to subdomains.
  /* @hidden
   */
  public readonly routes: SandboxRouteData[];

  /**
   * A `node:fs/promises`-compatible API for interacting with the sandbox filesystem.
   *
   * @example
   * const content = await sandbox.fs.readFile('/etc/hostname', 'utf8');
   * await sandbox.fs.writeFile('/tmp/hello.txt', 'Hello, world!');
   * const files = await sandbox.fs.readdir('/tmp');
   * const stats = await sandbox.fs.stat('/tmp/hello.txt');
   */
  public readonly fs: FileSystem;

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
   * The network policy of the sandbox.
   */
  public get networkPolicy(): NetworkPolicy | undefined {
    return this.sandbox.networkPolicy;
  }

  /**
   * If the sandbox was created from a snapshot, the ID of that snapshot.
   */
  public get sourceSnapshotId(): string | undefined {
    return this.sandbox.sourceSnapshotId;
  }

  /**
   * The amount of CPU used by the sandbox. Only reported once the VM is stopped.
   */
  public get activeCpuUsageMs(): number | undefined {
    return this.sandbox.activeCpuDurationMs;
  }

  /**
   * The amount of network data used by the sandbox. Only reported once the VM is stopped.
   */
  public get networkTransfer():
    | { ingress: number; egress: number }
    | undefined {
    return this.sandbox.networkTransfer;
  }

  /**
   * Internal metadata about this sandbox.
   */
  private sandbox: SandboxSnapshot;

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
    "use step";
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
   * Serialize a Sandbox instance to plain data for @workflow/serde.
   *
   * @param instance - The Sandbox instance to serialize
   * @returns A plain object containing sandbox metadata and routes
   */
  static [WORKFLOW_SERIALIZE](instance: Sandbox): SerializedSandbox {
    const serialized: SerializedSandbox = {
      metadata: instance.sandbox,
      routes: instance.routes,
    };
    if (Object.keys(instance.spanLinkPrivateParams).length > 0) {
      serialized.spanLinkPrivateParams = instance.spanLinkPrivateParams;
    }
    return serialized;
  }

  /**
   * Deserialize a Sandbox from serialized snapshot data.
   *
   * The deserialized instance uses the serialized metadata synchronously and
   * lazily creates an API client only when methods perform API requests.
   *
   * @param data - The serialized sandbox data
   * @returns The reconstructed Sandbox instance
   */
  static [WORKFLOW_DESERIALIZE](data: SerializedSandbox): Sandbox {
    return new Sandbox({
      sandbox: data.metadata,
      routes: data.routes,
      spanLinkPrivateParams: data.spanLinkPrivateParams,
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
    "use step";
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params?.fetch,
    });

    const privateParams = getPrivateParams(params);
    const spanLinkPrivateParams = getSpanLinkPrivateParams(params);
    const sandbox = await client.createSandbox({
      source: params?.source,
      projectId: credentials.projectId,
      ports: params?.ports ?? [],
      timeout: params?.timeout,
      resources: params?.resources,
      runtime: params && "runtime" in params ? params?.runtime : undefined,
      networkPolicy: params?.networkPolicy,
      env: params?.env,
      signal: params?.signal,
      ...privateParams,
    });

    return new DisposableSandbox({
      client,
      sandbox: toSandboxSnapshot(sandbox.json.sandbox),
      routes: sandbox.json.routes,
      spanLinkPrivateParams,
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
    "use step";
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params.fetch,
    });

    const privateParams = getPrivateParams(params);
    const spanLinkPrivateParams = getSpanLinkPrivateParams(params);
    const sandbox = await client.getSandbox({
      sandboxId: params.sandboxId,
      signal: params.signal,
      ...privateParams,
    });

    return new Sandbox({
      client,
      sandbox: toSandboxSnapshot(sandbox.json.sandbox),
      routes: sandbox.json.routes,
      spanLinkPrivateParams,
    });
  }

  /**
   * Create a new Sandbox instance.
   *
   * @param params.client - Optional API client. If not provided, will be lazily created using global credentials.
   * @param params.routes - Port-to-subdomain mappings for exposed ports
   * @param params.sandbox - Sandbox snapshot metadata
   */
  constructor({
    client,
    routes,
    sandbox,
    spanLinkPrivateParams,
  }: {
    client?: APIClient;
    routes: SandboxRouteData[];
    sandbox: SandboxSnapshot;
    spanLinkPrivateParams?: Record<string, unknown>;
  }) {
    this._client = client ?? null;
    this.routes = routes;
    this.sandbox = sandbox;
    this.spanLinkPrivateParams = spanLinkPrivateParams ?? {};
    this.fs = new FileSystem(this);
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
    "use step";
    const client = await this.ensureClient();
    const command = await client.getCommand({
      sandboxId: this.sandbox.id,
      cmdId,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
    });

    return new Command({
      client,
      sandboxId: this.sandbox.id,
      cmd: command.json.command,
      spanLinkPrivateParams: this.spanLinkPrivateParams,
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
    "use step";
    const client = await this.ensureClient();
    const params: RunCommandParams =
      typeof commandOrParams === "string"
        ? { cmd: commandOrParams, args, signal: opts?.signal }
        : commandOrParams;

    const wait = params.detached ? false : true;
    const pipeLogs = async (command: Command): Promise<void> => {
      if (!params.stdout && !params.stderr) {
        return;
      }

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
    };

    if (wait) {
      const commandStream = await client.runCommand({
        sandboxId: this.sandbox.id,
        command: params.cmd,
        args: params.args ?? [],
        cwd: params.cwd,
        env: params.env ?? {},
        sudo: params.sudo ?? false,
        wait: true,
        signal: params.signal,
        ...this.spanLinkPrivateParams,
      });

      const command = new Command({
        client,
        sandboxId: this.sandbox.id,
        cmd: commandStream.command,
        spanLinkPrivateParams: this.spanLinkPrivateParams,
      });

      const [finished] = await Promise.all([
        commandStream.finished,
        pipeLogs(command),
      ]);
      return new CommandFinished({
        client,
        sandboxId: this.sandbox.id,
        cmd: finished,
        exitCode: finished.exitCode ?? 0,
        spanLinkPrivateParams: this.spanLinkPrivateParams,
      });
    }

    const commandResponse = await client.runCommand({
      sandboxId: this.sandbox.id,
      command: params.cmd,
      args: params.args ?? [],
      cwd: params.cwd,
      env: params.env ?? {},
      sudo: params.sudo ?? false,
      signal: params.signal,
      ...this.spanLinkPrivateParams,
    });

    const command = new Command({
      client,
      sandboxId: this.sandbox.id,
      cmd: commandResponse.json.command,
      spanLinkPrivateParams: this.spanLinkPrivateParams,
    });

    void pipeLogs(command).catch((err) => {
      if (params.signal?.aborted) {
        return;
      }
      (params.stderr ?? params.stdout)?.emit("error", err);
    });

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
    "use step";
    const client = await this.ensureClient();
    await client.mkDir({
      sandboxId: this.sandbox.id,
      path: path,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
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
    "use step";
    const client = await this.ensureClient();
    return client.readFile({
      sandboxId: this.sandbox.id,
      path: file.path,
      cwd: file.cwd,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
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
    "use step";
    const client = await this.ensureClient();
    const stream = await client.readFile({
      sandboxId: this.sandbox.id,
      path: file.path,
      cwd: file.cwd,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
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
    "use step";
    const client = await this.ensureClient();
    if (!src?.path) {
      throw new Error("downloadFile: source path is required");
    }

    if (!dst?.path) {
      throw new Error("downloadFile: destination path is required");
    }

    const stream = await client.readFile({
      sandboxId: this.sandbox.id,
      path: src.path,
      cwd: src.cwd,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
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
   * Write files to the filesystem of this sandbox.
   * Defaults to writing to /vercel/sandbox unless an absolute path is specified.
   * Writes files using the `vercel-sandbox` user.
   *
   * @param files - Array of files with path, content, and optional mode (permissions)
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves when the files are written
   *
   * @example
   * // Write an executable script
   * await sandbox.writeFiles([
   *   { path: "/usr/local/bin/myscript", content: "#!/bin/bash\necho hello", mode: 0o755 }
   * ]);
   */
  async writeFiles(
    files: {
      path: string;
      content: string | Uint8Array;
      mode?: number;
    }[],
    opts?: { signal?: AbortSignal },
  ) {
    "use step";
    const client = await this.ensureClient();
    return client.writeFiles({
      sandboxId: this.sandbox.id,
      cwd: this.sandbox.cwd,
      extractDir: "/",
      files: files,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
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
   * @param opts.blocking - If true, poll until the sandbox has fully stopped and return the final state.
   * @returns The sandbox metadata at the time the stop was acknowledged, or after fully stopped if `blocking` is true.
   */
  async stop(opts?: {
    signal?: AbortSignal;
    blocking?: boolean;
  }): Promise<SandboxSnapshot> {
    "use step";
    const client = await this.ensureClient();
    const response = await client.stopSandbox({
      sandboxId: this.sandbox.id,
      signal: opts?.signal,
      blocking: opts?.blocking,
      ...this.spanLinkPrivateParams,
    });
    this.sandbox = toSandboxSnapshot(response.json.sandbox);
    return this.sandbox;
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
   *   allow: ["*.npmjs.org", "github.com"],
   * });
   *
   * @example
   * // Inject credentials with per-domain transformers
   * await sandbox.updateNetworkPolicy({
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
   * await sandbox.updateNetworkPolicy("deny-all");
   */
  async updateNetworkPolicy(
    networkPolicy: NetworkPolicy,
    opts?: { signal?: AbortSignal },
  ): Promise<NetworkPolicy> {
    "use step";
    const client = await this.ensureClient();
    const response = await client.updateNetworkPolicy({
      sandboxId: this.sandbox.id,
      networkPolicy: networkPolicy,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
    });

    // Update the internal sandbox metadata with the new timeout value
    this.sandbox = toSandboxSnapshot(response.json.sandbox);
    return this.sandbox.networkPolicy!;
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
    "use step";
    const client = await this.ensureClient();
    const response = await client.extendTimeout({
      sandboxId: this.sandbox.id,
      duration,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
    });

    // Update the internal sandbox metadata with the new timeout value
    this.sandbox = toSandboxSnapshot(response.json.sandbox);
  }

  /**
   * Create a snapshot from this currently running sandbox. New sandboxes can
   * then be created from this snapshot using {@link Sandbox.createFromSnapshot}.
   *
   * Note: this sandbox will be stopped as part of the snapshot creation process.
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
    "use step";
    const client = await this.ensureClient();
    const response = await client.createSnapshot({
      sandboxId: this.sandbox.id,
      expiration: opts?.expiration,
      signal: opts?.signal,
      ...this.spanLinkPrivateParams,
    });

    this.sandbox = toSandboxSnapshot(response.json.sandbox);

    return new Snapshot({
      client,
      snapshot: response.json.snapshot,
      spanLinkPrivateParams: this.spanLinkPrivateParams,
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
