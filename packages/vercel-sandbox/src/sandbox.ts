import type { SandboxMetaData, SandboxRouteData, NamedSandboxMetaData } from "./api-client";
import { APIClient } from "./api-client";
import { APIError } from "./api-client/api-error";
import { type Credentials, getCredentials } from "./utils/get-credentials";
import { getPrivateParams, type WithPrivate } from "./utils/types";
import type { WithFetchOptions } from "./api-client/api-client";
import type { RUNTIMES } from "./constants";
import { Session, type RunCommandParams } from "./session";
import type { Command, CommandFinished } from "./command";
import type { Snapshot } from "./snapshot";
import type { ConvertedSandbox } from "./utils/convert-sandbox";
import type {
    NetworkPolicy,
} from "./network-policy";
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
   * An AbortSignal to cancel sandbox creation.
   */
  signal?: AbortSignal;

  /**
   * Whether to enable snapshots on shutdown. Defaults to true.
   */
  snapshotOnShutdown?: boolean;
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

/**
 * A Sandbox is a persistent named entity backed by isolated Linux MicroVMs.
 * Each time it runs, it creates a "session" (the actual VM). Use
 * {@link Sandbox.currentSession} to obtain the {@link Session} instance and
 * interact with the VM.
 *
 * Use {@link Sandbox.create} or {@link Sandbox.get} to construct.
 * @hideconstructor
 */
export class Sandbox {
  private readonly client: APIClient;
  private readonly projectId: string;

  /**
   * Internal Session instance for the current VM.
   */
  private _session: Session;

  /**
   * Internal metadata about the named sandbox.
   */
  private namedSandbox: NamedSandboxMetaData;

  /**
   * The name of this sandbox.
   */
  public get name(): string {
    return this.namedSandbox.name;
  }

  /**
   * Whether this sandbox snapshots on shutdown.
   */
  public get snapshotOnShutdown(): boolean {
    return this.namedSandbox.snapshotOnShutdown;
  }

  /**
   * Allow to get a list of named sandboxes for a team narrowed to the given params.
   * It returns both the sandboxes and the pagination metadata to allow getting
   * the next page of results.
   */
  static async list(
    params?: Partial<Parameters<APIClient["listNamedSandboxes"]>[0]> &
      Partial<Credentials> &
      WithFetchOptions,
  ) {
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params?.fetch,
    });
    return client.listNamedSandboxes({
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
    const response = await client.createSandbox({
      source: params?.source,
      projectId: credentials.projectId,
      ports: params?.ports ?? [],
      timeout: params?.timeout,
      resources: params?.resources,
      runtime: params && "runtime" in params ? params?.runtime : undefined,
      networkPolicy: params?.networkPolicy,
      signal: params?.signal,
      name: params?.name,
      snapshotOnShutdown: params?.snapshotOnShutdown,
      ...privateParams,
    });

    return new DisposableSandbox({
      client,
      session: response.json.sandbox,
      namedSandbox: response.json.namedSandbox,
      routes: response.json.routes,
      projectId: credentials.projectId,
    });
  }

  /**
   * Retrieve an existing named sandbox and resume its session.
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

    const response = await client.getNamedSandbox({
      name: params.name,
      projectId: credentials.projectId,
      resume: params.resume,
      signal: params.signal,
    });

    return new Sandbox({
      client,
      session: response.json.sandbox,
      namedSandbox: response.json.namedSandbox,
      routes: response.json.routes,
      projectId: credentials.projectId,
    });
  }

  constructor({
    client,
    routes,
    session,
    namedSandbox,
    projectId,
  }: {
    client: APIClient;
    routes: SandboxRouteData[];
    session: SandboxMetaData;
    namedSandbox: NamedSandboxMetaData;
    projectId: string;
  }) {
    this.client = client;
    this._session = new Session({ client, routes, session });
    this.namedSandbox = namedSandbox;
    this.projectId = projectId;
  }

  /**
   * Get the current session (the running VM) for this sandbox.
   *
   * @returns The {@link Session} instance.
   */
  currentSession(): Session {
    return this._session;
  }

  /**
   * Resume this sandbox by creating a new session via `getNamedSandbox`.
   */
  private async resume(signal?: AbortSignal): Promise<void> {
    const response = await this.client.getNamedSandbox({
      name: this.namedSandbox.name,
      projectId: this.projectId,
      resume: true,
      signal,
    });
    this._session = new Session({
      client: this.client,
      routes: response.json.routes,
      session: response.json.sandbox,
    });
  }

  /**
   * Poll until the current session reaches a terminal state, then resume.
   */
  private async waitForStopAndResume(signal?: AbortSignal): Promise<void> {
    let status = this._session.status;
    while (status === "stopping" || status === "snapshotting") {
      await setTimeout(500, undefined, { signal });
      const poll = await this.client.getSandbox({
        sandboxId: this._session.sandboxId,
        signal,
      });
      status = poll.json.sandbox.status;
    }
    await this.resume(signal);
  }

  /**
   * Execute `fn`, and if the session is stopped/stopping, resume and retry.
   */
  private async withResume<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isSandboxStoppedError(err)) {
        await this.resume(signal);
        return fn();
      }
      if (isSandboxStoppingError(err)) {
        await this.waitForStopAndResume(signal);
        return fn();
      }
      throw err;
    }
  }

  // -- Session delegate getters --------------------------------------------------

  /**
   * Routes from ports to subdomains.
   * @hidden
   */
  public get routes(): SandboxRouteData[] {
    return this._session.routes;
  }

  /** Unique ID of this sandbox's current session. */
  public get sandboxId(): string {
    return this._session.sandboxId;
  }

  public get interactivePort(): number | undefined {
    return this._session.interactivePort;
  }

  /** The status of the current session. */
  public get status(): SandboxMetaData["status"] {
    return this._session.status;
  }

  /** The creation date of the current session. */
  public get createdAt(): Date {
    return this._session.createdAt;
  }

  /** The timeout of the current session in milliseconds. */
  public get timeout(): number {
    return this._session.timeout;
  }

  /** The network policy of the current session. */
  public get networkPolicy(): NetworkPolicy | undefined {
    return this._session.networkPolicy;
  }

  /** If the session was created from a snapshot, the ID of that snapshot. */
  public get sourceSnapshotId(): string | undefined {
    return this._session.sourceSnapshotId;
  }

  /** The amount of CPU used by the session. Only reported once the VM is stopped. */
  public get activeCpuUsageMs(): number | undefined {
    return this._session.activeCpuUsageMs;
  }

  /** The amount of network data used by the session. Only reported once the VM is stopped. */
  public get networkTransfer(): {ingress: number, egress: number} | undefined {
    return this._session.networkTransfer;
  }

  // -- Session delegate methods --------------------------------------------------

  /** Shortcut for `currentSession().runCommand(...)`. */
  async runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<CommandFinished>;
  async runCommand(
    params: RunCommandParams & { detached: true },
  ): Promise<Command>;
  async runCommand(params: RunCommandParams): Promise<CommandFinished>;
  async runCommand(
    commandOrParams: string | RunCommandParams,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<Command | CommandFinished> {
    const signal = typeof commandOrParams === "string" ? opts?.signal : commandOrParams.signal;
    return this.withResume(
      () => this._session.runCommand(commandOrParams as any, args, opts),
      signal,
    );
  }

  /** Shortcut for `currentSession().getCommand(...)`. */
  async getCommand(
    cmdId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<Command> {
    return this.withResume(
      () => this._session.getCommand(cmdId, opts),
      opts?.signal,
    );
  }

  /** Shortcut for `currentSession().mkDir(...)`. */
  async mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void> {
    return this.withResume(
      () => this._session.mkDir(path, opts),
      opts?.signal,
    );
  }

  /** Shortcut for `currentSession().readFile(...)`. */
  async readFile(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null> {
    return this.withResume(
      () => this._session.readFile(file, opts),
      opts?.signal,
    );
  }

  /** Shortcut for `currentSession().readFileToBuffer(...)`. */
  async readFileToBuffer(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null> {
    return this.withResume(
      () => this._session.readFileToBuffer(file, opts),
      opts?.signal,
    );
  }

  /** Shortcut for `currentSession().downloadFile(...)`. */
  async downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null> {
    return this.withResume(
      () => this._session.downloadFile(src, dst, opts),
      opts?.signal,
    );
  }

  /** Shortcut for `currentSession().writeFiles(...)`. */
  async writeFiles(
    files: { path: string; content: Buffer }[],
    opts?: { signal?: AbortSignal },
  ) {
    return this.withResume(
      () => this._session.writeFiles(files, opts),
      opts?.signal,
    );
  }

  /** Shortcut for `currentSession().domain(...)`. */
  domain(p: number): string {
    return this._session.domain(p);
  }

  /** Shortcut for `currentSession().stop(...)`. */
  async stop(opts?: { signal?: AbortSignal; blocking?: boolean }): Promise<ConvertedSandbox | void> {
    try {
      return await this._session.stop(opts);
    } catch (err) {
      if (isSandboxStoppedError(err)) return;
      throw err;
    }
  }

  /** Shortcut for `currentSession().updateNetworkPolicy(...)`. */
  async updateNetworkPolicy(
    networkPolicy: NetworkPolicy,
    opts?: { signal?: AbortSignal },
  ): Promise<NetworkPolicy> {
    return this.withResume(
      () => this._session.updateNetworkPolicy(networkPolicy, opts),
      opts?.signal,
    );
  }

  /** Shortcut for `currentSession().extendTimeout(...)`. */
  async extendTimeout(
    duration: number,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    return this.withResume(
      () => this._session.extendTimeout(duration, opts),
      opts?.signal,
    );
  }

  /** Shortcut for `currentSession().snapshot(...)`. */
  async snapshot(opts?: {
    expiration?: number;
    signal?: AbortSignal;
  }): Promise<Snapshot> {
    return this.withResume(
      () => this._session.snapshot(opts),
      opts?.signal,
    );
  }

  /**
   * List sessions (VMs) that have been created for this named sandbox.
   *
   * @param params - Optional pagination parameters.
   * @returns The list of sessions and pagination metadata.
   */
  async listSessions(params?: {
    limit?: number;
    since?: number | Date;
    until?: number | Date;
    signal?: AbortSignal;
  }) {
    return this.client.listSandboxes({
      projectId: this.projectId,
      name: this.namedSandbox.name,
      limit: params?.limit,
      since: params?.since,
      until: params?.until,
      signal: params?.signal,
    });
  }

  /**
   * List snapshots that belong to this named sandbox.
   *
   * @param params - Optional pagination parameters.
   * @returns The list of snapshots and pagination metadata.
   */
  async listSnapshots(params?: {
    limit?: number;
    since?: number | Date;
    until?: number | Date;
    signal?: AbortSignal;
  }) {
    return this.client.listSnapshots({
      projectId: this.projectId,
      name: this.namedSandbox.name,
      limit: params?.limit,
      since: params?.since,
      until: params?.until,
      signal: params?.signal,
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
