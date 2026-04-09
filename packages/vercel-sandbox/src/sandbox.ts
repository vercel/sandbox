import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import type {
  SessionMetaData,
  SandboxRouteData,
  SandboxMetaData,
} from "./api-client/index.js";
import { APIClient } from "./api-client/index.js";
import { APIError } from "./api-client/api-error.js";
import { type Credentials, getCredentials } from "./utils/get-credentials.js";
import { getPrivateParams, type WithPrivate } from "./utils/types.js";
import type { WithFetchOptions } from "./api-client/api-client.js";
import type { RUNTIMES } from "./constants.js";
import { Session, type RunCommandParams } from "./session.js";
import type { Command, CommandFinished } from "./command.js";
import type { Snapshot } from "./snapshot.js";
import type { SandboxSnapshot } from "./utils/sandbox-snapshot.js";
import type { NetworkPolicy } from "./network-policy.js";
import { fromAPINetworkPolicy } from "./utils/network-policy.js";
import { setTimeout } from "node:timers/promises";

export type { NetworkPolicy };

/** @inline */
export interface BaseCreateSandboxParams {
  /**
   * The name of the sandbox. If omitted, a random name will be generated.
   */
  name?: string;
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
   * Key-value tags to associate with the sandbox. Maximum 5 tags.
   * @example { env: "staging", team: "infra" }
   */
  tags?: Record<string, string>;

  /**
   * An AbortSignal to cancel sandbox creation.
   */
  signal?: AbortSignal;
  /**
   * Enable or disable automatic restore of the filesystem between sessions.
   */
  persistent?: boolean;
  /**
   * Default snapshot expiration in milliseconds.
   * When set, snapshots created for this sandbox will expire after this duration.
   * Use `0` for no expiration.
   */
  snapshotExpiration?: number;
  /**
   * Called when the sandbox session is resumed (e.g., after a snapshot restore).
   * Use this to re-warm caches, restore transient state, or run other setup logic.
   */
  onResume?: (sandbox: Sandbox) => Promise<void>;
}

export type CreateSandboxParams =
  | BaseCreateSandboxParams
  | (Omit<BaseCreateSandboxParams, "runtime" | "source"> & {
      source: { type: "snapshot"; snapshotId: string };
    });

/** @inline */
interface GetSandboxParams {
  /**
   * The name of the sandbox.
   */
  name: string;
  /**
   * Whether to resume an existing session. Defaults to true.
   */
  resume?: boolean;
  /**
   * An AbortSignal to cancel the operation.
   */
  signal?: AbortSignal;
  /**
   * Called when the sandbox session is resumed (e.g., after a snapshot restore).
   * Use this to re-warm caches, restore transient state, or run other setup logic.
   */
  onResume?: (sandbox: Sandbox) => Promise<void>;
}

function isSandboxStoppedError(err: unknown): boolean {
  return err instanceof APIError && err.response.status === 410;
}

function isSandboxStoppingError(err: unknown): boolean {
  return (
    err instanceof APIError &&
    err.response.status === 422 &&
    (err.json as any)?.error?.code === "sandbox_stopping"
  );
}

function isSandboxSnapshottingError(err: unknown): boolean {
  return (
    err instanceof APIError &&
    err.response.status === 422 &&
    (err.json as any)?.error?.code === "sandbox_snapshotting"
  );
}

/**
 * Serialized representation of a Sandbox for @workflow/serde.
 * Fields `metadata` and `routes` are the original wire format from main.
 * Fields `sandboxMetadata` and `projectId` are added for named-sandboxes.
 */
export interface SerializedSandbox {
  metadata: SandboxSnapshot;
  routes: SandboxRouteData[];
  sandboxMetadata?: SandboxMetaData;
  projectId?: string;
}

// ============================================================================
// Sandbox class
// ============================================================================

/**
 * A Sandbox is a persistent, isolated Linux MicroVMs to run commands in.
 * Use {@link Sandbox.create} or {@link Sandbox.get} to construct.
 * @hideconstructor
 */
export class Sandbox {
  private _client: APIClient | null = null;
  private readonly projectId: string;

  /**
   * In-flight resume promise, used to deduplicate concurrent resume calls.
   */
  private resumePromise: Promise<void> | null = null;

  /**
   * Internal Session instance for the current VM.
   */
  private session: Session | undefined;

  /**
   * Internal metadata about the sandbox.
   */
  private sandbox: SandboxMetaData;

  /**
   * Hook that will be executed when a new session is created during resume.
   */
  private readonly onResume?: (sandbox: Sandbox) => Promise<void>;

  /**
   * Lazily resolve credentials and construct an API client.
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
   * The name of this sandbox.
   */
  public get name(): string {
    return this.sandbox.name;
  }

  /**
   * Routes from ports to subdomains.
   * @hidden
   */
  public get routes(): SandboxRouteData[] {
    return this.currentSession().routes;
  }

  /**
   * Whether the sandbox persists the state.
   */
  public get persistent(): boolean {
    return this.sandbox.persistent;
  }

  /**
   * The region this sandbox runs in.
   */
  public get region(): string | undefined {
    return this.sandbox.region;
  }

  /**
   * Number of virtual CPUs allocated.
   */
  public get vcpus(): number | undefined {
    return this.sandbox.vcpus;
  }

  /**
   * Memory allocated in MB.
   */
  public get memory(): number | undefined {
    return this.sandbox.memory;
  }

  /** Runtime identifier (e.g. "node24", "python3.13"). */
  public get runtime(): string | undefined {
    return this.sandbox.runtime;
  }

  /**
   * Cumulative egress bytes across all sessions.
   */
  public get totalEgressBytes(): number | undefined {
    return this.sandbox.totalEgressBytes;
  }

  /**
   * Cumulative ingress bytes across all sessions.
   */
  public get totalIngressBytes(): number | undefined {
    return this.sandbox.totalIngressBytes;
  }

  /**
   * Cumulative active CPU duration in milliseconds across all sessions.
   */
  public get totalActiveCpuDurationMs(): number | undefined {
    return this.sandbox.totalActiveCpuDurationMs;
  }

  /**
   * Cumulative wall-clock duration in milliseconds across all sessions.
   */
  public get totalDurationMs(): number | undefined {
    return this.sandbox.totalDurationMs;
  }

  /**
   * When this sandbox was last updated.
   */
  public get updatedAt(): Date {
    return new Date(this.sandbox.updatedAt);
  }

  /**
   * When the sandbox status was last updated.
   */
  public get statusUpdatedAt(): Date | undefined {
    return this.sandbox.statusUpdatedAt
      ? new Date(this.sandbox.statusUpdatedAt)
      : undefined;
  }

  /**
   * When this sandbox was created.
   */
  public get createdAt(): Date {
    return new Date(this.sandbox.createdAt);
  }

  /**
   * Interactive port.
   */
  public get interactivePort(): number | undefined {
    return this.currentSession().interactivePort;
  }

  /**
   * The status of the current session.
   */
  public get status(): SessionMetaData["status"] {
    return this.currentSession().status;
  }

  /**
   * The default timeout of this sandbox in milliseconds.
   */
  public get timeout(): number | undefined {
    return this.sandbox.timeout;
  }

  /**
   * Key-value tags attached to the sandbox.
   */
  public get tags(): Record<string, string> | undefined {
    return this.sandbox.tags;
  }

  /**
   * The default network policy of this sandbox.
   */
  public get networkPolicy(): NetworkPolicy | undefined {
    return this.sandbox.networkPolicy
      ? fromAPINetworkPolicy(this.sandbox.networkPolicy)
      : undefined;
  }

  /**
   * If the session was created from a snapshot, the ID of that snapshot.
   */
  public get sourceSnapshotId(): string | undefined {
    return this.currentSession().sourceSnapshotId;
  }

  /**
   * The current snapshot ID of this sandbox, if any.
   */
  public get currentSnapshotId(): string | undefined {
    return this.sandbox.currentSnapshotId;
  }

  /**
   * The default snapshot expiration in milliseconds, if set.
   */
  public get snapshotExpiration(): number | undefined {
    return this.sandbox.snapshotExpiration;
  }

  /**
   * The amount of CPU used by the session. Only reported once the VM is stopped.
   */
  public get activeCpuUsageMs(): number | undefined {
    return this.currentSession().activeCpuUsageMs;
  }

  /**
   * The amount of network data used by the session. Only reported once the VM is stopped.
   */
  public get networkTransfer():
    | { ingress: number; egress: number }
    | undefined {
    return this.currentSession().networkTransfer;
  }

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
    const response = await client.listSandboxes({
      ...credentials,
      ...params,
    });
    return response.json;
  }

  /**
   * Serialize a Sandbox instance to plain data for @workflow/serde.
   *
   * @param instance - The Sandbox instance to serialize
   * @returns A plain object containing sandbox metadata and routes
   */
  static [WORKFLOW_SERIALIZE](instance: Sandbox): SerializedSandbox {
    return {
      metadata: instance.session?._sessionSnapshot!,
      routes: instance.session?.routes ?? [],
      sandboxMetadata: instance.sandbox,
      projectId: instance.projectId,
    };
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
    const sandbox = new Sandbox({
      sandbox: data.sandboxMetadata!,
      routes: data.routes,
      projectId: data.projectId,
    });
    if (data.metadata) {
      sandbox.session = new Session({ routes: data.routes, snapshot: data.metadata });
    }
    return sandbox;
  }

  /**
   * Create a new sandbox.
   *
   * @param params - Creation parameters and optional credentials.
   * @returns A promise resolving to the created {@link Sandbox}.
   * @example
   * <caption>Create a sandbox with default options</caption>
   * const sandbox = await Sandbox.create();
   *
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
    const response = await client.createSandbox({
      source: params?.source,
      projectId: credentials.projectId,
      ports: params?.ports ?? [],
      timeout: params?.timeout,
      resources: params?.resources,
      runtime: params && "runtime" in params ? params?.runtime : undefined,
      networkPolicy: params?.networkPolicy,
      env: params?.env,
      tags: params?.tags,
      snapshotExpiration: params?.snapshotExpiration,
      signal: params?.signal,
      name: params?.name,
      persistent: params?.persistent,
      ...privateParams,
    });

    return new DisposableSandbox({
      client,
      session: response.json.session,
      sandbox: response.json.sandbox,
      routes: response.json.routes,
      projectId: credentials.projectId,
      onResume: params?.onResume,
    });
  }

  /**
   * Retrieve an existing sandbox and resume its session.
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
    const response = await client.getSandbox({
      name: params.name,
      projectId: credentials.projectId,
      resume: params.resume,
      signal: params.signal,
      ...privateParams,
    });

    const sandbox = new Sandbox({
      client,
      session: response.json.session,
      sandbox: response.json.sandbox,
      routes: response.json.routes,
      projectId: credentials.projectId,
      onResume: params.onResume,
    });

    if (response.json.resumed && params.onResume) {
      await params.onResume(sandbox);
    }

    return sandbox;
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
    session,
    sandbox,
    projectId,
    onResume,
  }: {
    client?: APIClient;
    routes: SandboxRouteData[];
    session?: SessionMetaData;
    sandbox: SandboxMetaData;
    projectId?: string;
    onResume?: (sandbox: Sandbox) => Promise<void>;
  }) {
    this._client = client ?? null;
    if (session) {
      this.session = new Session({ client: client!, routes, session });
    }
    this.sandbox = sandbox;
    this.projectId = projectId ?? "";
    this.onResume = onResume;
  }

  /**
   * Get the current session (the running VM) for this sandbox.
   *
   * @returns The {@link Session} instance.
   */
  currentSession(): Session {
    if (!this.session) {
      throw new Error("No active session. Run a command or call resume first.");
    }
    return this.session;
  }

  /**
   * Resume this sandbox by creating a new session via `getSandbox`.
   */
  private async resume(signal?: AbortSignal): Promise<void> {
    if (!this.resumePromise) {
      this.resumePromise = this.doResume(signal).finally(() => {
        this.resumePromise = null;
      });
    }
    return this.resumePromise;
  }

  private async doResume(signal?: AbortSignal): Promise<void> {
    const client = await this.ensureClient();
    const response = await client.getSandbox({
      name: this.sandbox.name,
      projectId: this.projectId,
      resume: true,
      signal,
    });
    this.session = new Session({
      client,
      routes: response.json.routes,
      session: response.json.session,
    });
    if (this.onResume && response.json.resumed) {
      await this.onResume(this);
    }
  }

  /**
   * Poll until the current session reaches a terminal state, then resume.
   */
  private async waitForStopAndResume(signal?: AbortSignal): Promise<void> {
    "use step";
    const client = await this.ensureClient();
    const pollingInterval = 500;
    let status = this.session!.status;

    while (status === "stopping" || status === "snapshotting") {
      await setTimeout(pollingInterval, undefined, { signal });
      const poll = await client.getSession({
        sessionId: this.session!.sessionId,
        signal,
      });
      this.session = new Session({
        client,
        routes: poll.json.routes,
        session: poll.json.session,
      });
      status = poll.json.session.status;
    }
    await this.resume(signal);
  }

  /**
   * Execute `fn`, and if the session is stopped/stopping/snapshotting, resume and retry.
   */
  private async withResume<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.session) {
      await this.resume(signal);
    }
    try {
      return await fn();
    } catch (err) {
      if (isSandboxStoppedError(err)) {
        await this.resume(signal);
        return fn();
      }
      if (isSandboxStoppingError(err) || isSandboxSnapshottingError(err)) {
        await this.waitForStopAndResume(signal);
        return fn();
      }
      throw err;
    }
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
    const signal =
      typeof commandOrParams === "string"
        ? opts?.signal
        : commandOrParams.signal;
    return this.withResume(
      () => this.session!.runCommand(commandOrParams as any, args, opts),
      signal,
    );
  }

  /**
   * Internal helper to start a command in the sandbox.
   *
   * @param params - Command execution parameters.
   * @returns A {@link Command} or {@link CommandFinished}, depending on `detached`.
   * @internal
   */
  async getCommand(
    cmdId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Command> {
    "use step";
    return this.withResume(
      () => this.session!.getCommand(cmdId, opts),
      opts?.signal,
    );
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
    return this.withResume(
      () => this.session!.mkDir(path, opts),
      opts?.signal,
    );
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
    return this.withResume(
      () => this.session!.readFile(file, opts),
      opts?.signal,
    );
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
    return this.withResume(
      () => this.session!.readFileToBuffer(file, opts),
      opts?.signal,
    );
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
    return this.withResume(
      () => this.session!.downloadFile(src, dst, opts),
      opts?.signal,
    );
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
    return this.withResume(
      () => this.session!.writeFiles(files, opts),
      opts?.signal,
    );
  }

  /**
   * Get the public domain of a port of this sandbox.
   *
   * @param p - Port number to resolve
   * @returns A full domain (e.g. `https://subdomain.vercel.run`)
   * @throws If the port has no associated route
   */
  domain(p: number): string {
    return this.currentSession().domain(p);
  }

  /**
   * Stop the sandbox.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @param opts.blocking - If true, poll until the sandbox has fully stopped and return the final state.
   * @returns The sandbox at the time the stop was acknowledged, or after fully stopped if `blocking` is true.
   */
  async stop(opts?: {
    signal?: AbortSignal;
    blocking?: boolean;
  }): Promise<SandboxSnapshot> {
    "use step";
    if (!this.session) {
      throw new Error("No active session to stop.");
    }
    return this.session.stop(opts);
  }

  /**
   * Update the network policy for this sandbox.
   *
   * @deprecated Use {@link Sandbox.update} instead.
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
    await this.withResume(
      () => this.session!.update({ networkPolicy: networkPolicy }, opts),
      opts?.signal,
    );

    return this.session!.networkPolicy!;
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
    return this.withResume(
      () => this.session!.extendTimeout(duration, opts),
      opts?.signal,
    );
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
    return this.withResume(
      () => this.session!.snapshot(opts),
      opts?.signal,
    );
  }

  /**
   * Update the sandbox configuration.
   *
   * @param params - Fields to update.
   * @param opts - Optional abort signal.
   */
  async update(
    params: {
      persistent?: boolean;
      resources?: { vcpus?: number };
      timeout?: number;
      networkPolicy?: NetworkPolicy;
      tags?: Record<string, string>;
      snapshotExpiration?: number;
    },
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    "use step";
    const client = await this.ensureClient();
    let resources: { vcpus: number; memory: number } | undefined;
    if (params.resources?.vcpus) {
      resources = {
        vcpus: params.resources.vcpus,
        memory: params.resources.vcpus * 2048,
      };
    }

    // Update the sandbox config. This config will be used on the next session.
    const response = await client.updateSandbox({
      name: this.sandbox.name,
      projectId: this.projectId,
      persistent: params.persistent,
      resources,
      timeout: params.timeout,
      networkPolicy: params.networkPolicy,
      tags: params.tags,
      snapshotExpiration: params.snapshotExpiration,
      signal: opts?.signal,
    });
    this.sandbox = response.json.sandbox;

    // Update the current session config. This only applies to network policy.
    if (params.networkPolicy) {
      try {
        return await this.session?.update(
          { networkPolicy: params.networkPolicy },
          opts,
        );
      } catch (err) {
        if (isSandboxStoppedError(err) || isSandboxStoppingError(err)) {
          return;
        }
        throw err;
      }
    }
  }

  /**
   * Delete this sandbox.
   *
   * After deletion the instance becomes inert — all further API calls will
   * throw immediately.
   */
  async delete(opts?: { signal?: AbortSignal }): Promise<void> {
    "use step";
    const client = await this.ensureClient();
    await client.deleteSandbox({
      name: this.sandbox.name,
      projectId: this.projectId,
      signal: opts?.signal,
    });
  }

  /**
   * List sessions (VMs) that have been created for this sandbox.
   *
   * @param params - Optional pagination parameters.
   * @returns The list of sessions and pagination metadata.
   */
  async listSessions(params?: {
    limit?: number;
    cursor?: string;
    sortOrder?: "asc" | "desc";
    signal?: AbortSignal;
  }) {
    "use step";
    const client = await this.ensureClient();
    const response = await client.listSessions({
      projectId: this.projectId,
      name: this.sandbox.name,
      limit: params?.limit,
      cursor: params?.cursor,
      sortOrder: params?.sortOrder,
      signal: params?.signal,
    });
    return response.json;
  }

  /**
   * List snapshots that belong to this sandbox.
   *
   * @param params - Optional pagination parameters.
   * @returns The list of snapshots and pagination metadata.
   */
  async listSnapshots(params?: {
    limit?: number;
    cursor?: string;
    sortOrder?: "asc" | "desc";
    signal?: AbortSignal;
  }) {
    "use step";
    const client = await this.ensureClient();
    const response = await client.listSnapshots({
      projectId: this.projectId,
      name: this.sandbox.name,
      limit: params?.limit,
      cursor: params?.cursor,
      sortOrder: params?.sortOrder,
      signal: params?.signal,
    });
    return response.json;
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
