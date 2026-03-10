import type { SandboxMetaData, SandboxRouteData } from "./api-client";
import { APIClient } from "./api-client";
import { WithFetchOptions } from "./api-client/api-client";
import { Command, CommandFinished } from "./command";
import { RUNTIMES } from "./constants";
import {
  createSandboxClient,
  createSnapshot as createSnapshotBySandboxId,
  downloadFile as downloadFileBySandboxId,
  extendSandboxTimeout as extendSandboxTimeoutBySandboxId,
  getCommand as getCommandBySandboxId,
  mkDir as mkDirBySandboxId,
  readFile as readFileBySandboxId,
  readFileToBuffer as readFileToBufferBySandboxId,
  runCommand as runCommandBySandboxId,
  type RunCommandParams,
  type SandboxAccessOptions,
  stopSandbox as stopSandboxBySandboxId,
  updateSandboxNetworkPolicy as updateSandboxNetworkPolicyBySandboxId,
  writeFiles as writeFilesBySandboxId,
} from "./sandbox-operations";
import { Snapshot } from "./snapshot";
import { type Credentials, getCredentials } from "./utils/get-credentials";
import { convertSandbox, type ConvertedSandbox } from "./utils/convert-sandbox";
import { getPrivateParams, WithPrivate } from "./utils/types";
import {
  type NetworkPolicy,
  type NetworkPolicyRule,
  type NetworkTransformer,
} from "./network-policy";

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
  public get networkTransfer(): {ingress: number, egress: number} | undefined {
    return this.sandbox.networkTransfer;
  }

  /**
   * Internal metadata about this sandbox.
   */
  private sandbox: ConvertedSandbox;

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
      networkPolicy: params?.networkPolicy,
      env: params?.env,
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
    params: WithPrivate<GetSandboxParams & SandboxAccessOptions>,
  ): Promise<Sandbox> {
    const client = await createSandboxClient(params);

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
    this.sandbox = convertSandbox(sandbox);
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
    return getCommandBySandboxId(this.sandbox.id, cmdId, {
      signal: opts?.signal,
      client: this.client,
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
      ? runCommandBySandboxId(this.sandbox.id, commandOrParams, args, {
          signal: opts?.signal,
          client: this.client,
        })
      : runCommandBySandboxId(this.sandbox.id, commandOrParams, {
          client: this.client,
        });
  }

  /**
   * Create a directory in the filesystem of this sandbox.
   *
   * @param path - Path of the directory to create
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   */
  async mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void> {
    await mkDirBySandboxId(this.sandbox.id, path, {
      signal: opts?.signal,
      client: this.client,
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
    return readFileBySandboxId(this.sandbox.id, file, {
      signal: opts?.signal,
      client: this.client,
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
    return readFileToBufferBySandboxId(this.sandbox.id, file, {
      signal: opts?.signal,
      client: this.client,
    });
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
    return downloadFileBySandboxId(this.sandbox.id, src, dst, {
      mkdirRecursive: opts?.mkdirRecursive,
      signal: opts?.signal,
      client: this.client,
    });
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
  ): Promise<void> {
    await writeFilesBySandboxId(this.sandbox.id, files, {
      signal: opts?.signal,
      client: this.client,
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
  async stop(opts?: { signal?: AbortSignal; blocking?: boolean }): Promise<ConvertedSandbox> {
    this.sandbox = await stopSandboxBySandboxId(this.sandbox.id, {
      signal: opts?.signal,
      blocking: opts?.blocking,
      client: this.client,
    });
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
    const updatedNetworkPolicy = await updateSandboxNetworkPolicyBySandboxId(
      this.sandbox.id,
      networkPolicy,
      {
        signal: opts?.signal,
        client: this.client,
      },
    );

    this.sandbox = {
      ...this.sandbox,
      networkPolicy: updatedNetworkPolicy,
    };

    return updatedNetworkPolicy;
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
    await extendSandboxTimeoutBySandboxId(this.sandbox.id, duration, {
      signal: opts?.signal,
      client: this.client,
    });

    this.sandbox = {
      ...this.sandbox,
      timeout: this.sandbox.timeout + duration,
    };
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
    const snapshot = await createSnapshotBySandboxId(this.sandbox.id, {
      expiration: opts?.expiration,
      signal: opts?.signal,
      client: this.client,
    });

    const refreshedSandbox = await this.client.getSandbox({
      sandboxId: this.sandbox.id,
      signal: opts?.signal,
    });
    this.sandbox = convertSandbox(refreshedSandbox.json.sandbox);

    return snapshot;
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

