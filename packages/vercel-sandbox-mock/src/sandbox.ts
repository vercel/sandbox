import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import { Sandbox as JustBashSandbox } from "just-bash";
import type { IFileSystem } from "just-bash";
import type { Sandbox as RealSandbox, NetworkPolicy } from "@vercel/sandbox";
import { Command, CommandFinished } from "./command";
import type { CommandHandler } from "./handlers";
import {
  defaultHandlers,
  runtimeHandlers,
  handlersToCustomCommands,
  onResetHandlers,
  setupSandbox,
} from "./handlers";
import type { SandboxServer } from "./handlers";
import {
  APIError,
  Snapshot,
  getSnapshotFileSystem,
  listSnapshotMetadata,
  registerSnapshot,
  resetSnapshots,
} from "./stubs";
import type { SnapshotFileSystemEntry } from "./stubs";
import { Session } from "./session";
import { FileSystem } from "./filesystem";
import { createPaginator } from "./paginator";
import type { MockPaginator } from "./paginator";
import { SandboxUser } from "./sandbox-user";
import { validateName } from "./utils/validate-name";
import type { PublicShape, AssertExtends } from "./type-utils";

type Route = { url: string; subdomain: string; port: number };

type CreateParams = NonNullable<Parameters<typeof RealSandbox.create>[0]> & {
  handlers?: CommandHandler[];
  cwd?: string;
};

type GetOrCreateParams = NonNullable<Parameters<typeof RealSandbox.getOrCreate>[0]> & {
  handlers?: CommandHandler[];
  cwd?: string;
};

type ForkParams = Parameters<typeof RealSandbox.fork>[0] & {
  handlers?: CommandHandler[];
  cwd?: string;
};

type ListParams = NonNullable<Parameters<typeof RealSandbox.list>[0]> & {
  sandboxes?: CreateParams[];
};

type SandboxListItem = Awaited<ReturnType<typeof RealSandbox.list>>["sandboxes"][number];

type RunCommandParams = {
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

type LocalSessionConfig = {
  timeout: number;
  networkPolicy?: NetworkPolicy;
  memory: number;
  vcpus: number;
  region: string;
  runtime: string;
  cwd: string;
  routes: Route[];
  env?: Record<string, string>;
  handlers: CommandHandler[];
};

async function createLocalSession(config: LocalSessionConfig): Promise<Session> {
  const inner = await JustBashSandbox.create({
    cwd: config.cwd,
    env: config.env,
    customCommands: handlersToCustomCommands(config.handlers),
  });
  return new Session({
    inner,
    timeout: config.timeout,
    networkPolicy: config.networkPolicy,
    sourceSnapshotId: undefined,
    memory: config.memory,
    vcpus: config.vcpus,
    region: config.region,
    runtime: config.runtime,
    cwd: config.cwd,
    routes: config.routes,
    handlers: config.handlers,
  });
}

async function captureFileSystem(source: IFileSystem): Promise<SnapshotFileSystemEntry[]> {
  const entries: SnapshotFileSystemEntry[] = [];
  for (const path of source.getAllPaths().filter((path) => path !== "/")) {
    const stats = await source.lstat(path);
    if (stats.isDirectory) {
      entries.push({ path, mode: stats.mode, type: "directory" });
    } else if (stats.isSymbolicLink) {
      entries.push({
        path,
        type: "symlink",
        target: await source.readlink(path),
      });
    } else {
      entries.push({
        path,
        mode: stats.mode,
        type: "file",
        content: Buffer.from(await source.readFileBuffer(path)),
      });
    }
  }
  return entries;
}

async function restoreFileSystem(
  entries: SnapshotFileSystemEntry[],
  target: IFileSystem,
): Promise<void> {
  const targetPaths = new Set(target.getAllPaths());
  const orderedEntries = [...entries].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length,
  );

  for (const entry of orderedEntries) {
    if (entry.type === "directory" && !targetPaths.has(entry.path)) {
      await target.mkdir(entry.path, { recursive: true });
    }
  }

  for (const entry of orderedEntries) {
    if (entry.type === "directory") continue;
    if (entry.type === "symlink") {
      if (targetPaths.has(entry.path)) await target.rm(entry.path, { force: true });
      await target.symlink(entry.target, entry.path);
    } else {
      await target.writeFile(entry.path, entry.content);
    }
  }

  for (const entry of orderedEntries) {
    if (entry.type !== "symlink") await target.chmod(entry.path, entry.mode);
  }
}

type SessionMetadata = {
  [x: string]: unknown;
  id: string;
  memory: number;
  vcpus: number;
  region: string;
  runtime: string;
  timeout: number;
  status: "pending" | "running" | "stopping" | "stopped" | "failed" | "aborted" | "snapshotting";
  requestedAt: number;
  createdAt: number;
  cwd: string;
  updatedAt: number;
  startedAt?: number;
  requestedStopAt?: number;
  stoppedAt?: number;
  abortedAt?: number;
  duration?: number;
  sourceSnapshotId?: string;
  snapshottedAt?: number;
  interactivePort?: number;
  activeCpuDurationMs?: number;
  networkTransfer?: { ingress: number; egress: number };
};

type SnapshotMetadata = {
  [x: string]: unknown;
  id: string;
  sourceSessionId: string;
  status: "created" | "deleted" | "failed";
  sizeBytes: number;
  region: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
};

const instances = new Map<string, Sandbox>();
const pendingGetOrCreates = new Map<string, Promise<Sandbox>>();
onResetHandlers(() => {
  instances.clear();
  pendingGetOrCreates.clear();
  resetSnapshots();
});

function toSandboxListItem(sandbox: Sandbox): SandboxListItem {
  return {
    name: sandbox.name,
    persistent: sandbox.persistent,
    createdAt: sandbox.createdAt.getTime(),
    updatedAt: sandbox.updatedAt.getTime(),
    currentSessionId: sandbox.currentSession().sessionId,
    status: sandbox.status,
    region: sandbox.region,
    vcpus: sandbox.vcpus,
    memory: sandbox.memory,
    runtime: sandbox.runtime,
    timeout: sandbox.timeout,
    networkPolicy:
      typeof sandbox.networkPolicy === "string"
        ? { mode: sandbox.networkPolicy }
        : sandbox.networkPolicy
          ? { mode: "custom" }
          : undefined,
    expiresAt: sandbox.expiresAt?.getTime(),
    currentSnapshotId: sandbox.currentSnapshotId,
    statusUpdatedAt: sandbox.statusUpdatedAt?.getTime(),
    cwd: sandbox.cwd,
    tags: sandbox.tags,
    snapshotExpiration: sandbox.snapshotExpiration,
    keepLastSnapshots: sandbox.keepLastSnapshots,
  };
}

export class Sandbox {
  #name: string;
  #persistent: boolean;
  #region: string;
  #vcpus: number;
  #memory: number;
  #runtime: string;
  #routes: Route[];
  #timeout: number;
  #tags: Record<string, string> | undefined;
  #networkPolicy: NetworkPolicy | undefined;
  #sourceSnapshotId: string | undefined;
  #currentSnapshotId: string | undefined;
  #snapshotExpiration: number | undefined;
  #keepLastSnapshots: { count: number; expiration?: number; deleteEvicted?: boolean } | undefined;
  #createdAt = new Date();
  #updatedAt = new Date();
  #statusUpdatedAt: Date | undefined = undefined;
  #cwd: string;
  #env: Record<string, string> | undefined;
  #handlers: CommandHandler[];
  #onResume: CreateParams["onResume"];

  #sessions: Session[] = [];

  // In-memory simulation of Linux users/groups. just-bash has no real user
  // system (`useradd`/`groupadd`/`id` don't exist and `sudo` is a no-op), so
  // multi-user state is tracked here rather than shelled out.
  #users = new Map<string, { group: string }>();
  #groups = new Map<string, Set<string>>();
  #defaultUserPromise: Promise<{ username: string; group: string }> | undefined;
  // Deduplicates concurrent resumes, like the real SDK's `resumePromise`.
  #resumePromise: Promise<void> | undefined;

  static async create(params?: CreateParams): Promise<Sandbox & AsyncDisposable> {
    const cwd = params?.cwd ?? "/vercel/sandbox";
    const allHandlers = [...runtimeHandlers, ...(params?.handlers ?? []), ...defaultHandlers];

    const name = params?.name ?? randomUUID();
    const ports = params?.ports ?? [];
    const routes = ports.map((port) => ({
      url: `https://mock-${name}-${port}.sandbox.mock`,
      subdomain: `mock-${name}-${port}`,
      port,
    }));

    const sessionConfig = {
      timeout: params?.timeout ?? 300_000,
      networkPolicy: params?.networkPolicy,
      memory: 2048,
      vcpus: params?.resources?.vcpus ?? 1,
      region: "mock",
      runtime: params?.runtime ?? "node24",
      cwd,
      routes,
      env: params?.env,
      handlers: allHandlers,
    } satisfies LocalSessionConfig;
    const session = await createLocalSession(sessionConfig);

    const sandbox = new Sandbox({
      ...sessionConfig,
      name,
      persistent: params?.persistent ?? false,
      tags: params?.tags,
      sourceSnapshotId: undefined,
      snapshotExpiration: params?.snapshotExpiration,
      keepLastSnapshots: params?.keepLastSnapshots,
      onResume: params?.onResume,
      session,
    });

    instances.set(name, sandbox);

    const disposable = sandbox as Sandbox & AsyncDisposable;
    disposable[Symbol.asyncDispose] = () => sandbox.stop().then(() => undefined);
    return disposable;
  }

  static async get(params: Parameters<typeof RealSandbox.get>[0]): Promise<Sandbox> {
    const existing = instances.get(params.name);
    if (existing) {
      if (params.onResume) existing.#onResume = params.onResume;
      // Like the real SDK, `get` eagerly resumes a stopped sandbox (and fires
      // `onResume`) unless `resume: false` is passed.
      if (params.resume !== false) await existing.#ensureRunning();
      return existing;
    }
    throw new APIError(new Response(null, { status: 404, statusText: "Not Found" }), {
      message: `Sandbox not found: ${params.name}`,
    });
  }

  static async getOrCreate(params?: GetOrCreateParams): Promise<Sandbox> {
    if (!params?.name) {
      const sandbox = await Sandbox.create(params);
      await params?.onCreate?.(sandbox as unknown as RealSandbox);
      return sandbox;
    }

    const pending = pendingGetOrCreates.get(params.name);
    if (pending) return pending;

    const getOrCreate = (async () => {
      try {
        return await Sandbox.get(params as Parameters<typeof Sandbox.get>[0]);
      } catch (error) {
        if (!(error instanceof APIError) || error.response.status !== 404) throw error;
      }

      const sandbox = await Sandbox.create(params);
      await params.onCreate?.(sandbox as unknown as RealSandbox);
      return sandbox;
    })();
    pendingGetOrCreates.set(params.name, getOrCreate);

    try {
      return await getOrCreate;
    } finally {
      if (pendingGetOrCreates.get(params.name) === getOrCreate) {
        pendingGetOrCreates.delete(params.name);
      }
    }
  }

  static async fork(params: ForkParams): Promise<Sandbox & AsyncDisposable> {
    const { sourceSandbox: sourceName, ...overrides } = params;
    const source = await Sandbox.get({ name: sourceName, resume: false });
    const copied: CreateParams = {
      persistent: source.persistent,
      ...(source.vcpus !== undefined && { resources: { vcpus: source.vcpus } }),
      ...(source.timeout !== undefined && { timeout: source.timeout }),
      ...(source.networkPolicy !== undefined && { networkPolicy: source.networkPolicy }),
      ...(source.tags !== undefined && { tags: source.tags }),
      ...(source.routes.length > 0 && { ports: source.routes.map((route) => route.port) }),
      ...(source.snapshotExpiration !== undefined && {
        snapshotExpiration: source.snapshotExpiration,
      }),
      ...(source.keepLastSnapshots !== undefined && {
        keepLastSnapshots: source.keepLastSnapshots,
      }),
      ...(source.runtime !== undefined && { runtime: source.runtime }),
      cwd: source.cwd,
    };
    const fork = await Sandbox.create({ ...copied, ...overrides });
    const snapshot = source.currentSnapshotId
      ? getSnapshotFileSystem(source.currentSnapshotId)
      : undefined;
    if (snapshot) await restoreFileSystem(snapshot, fork.currentSession().fs);
    return fork;
  }

  static async list(params?: ListParams): Promise<MockPaginator<"sandboxes", SandboxListItem>> {
    for (const opts of params?.sandboxes ?? []) {
      await Sandbox.create(opts);
    }
    const sandboxes = [...instances.values()]
      .map(toSandboxListItem)
      .filter((sandbox) => !params?.namePrefix || sandbox.name.startsWith(params.namePrefix))
      .filter(
        (sandbox) =>
          !params?.tags ||
          Object.entries(params.tags).every(([key, value]) => sandbox.tags?.[key] === value),
      );
    const sortBy = params?.sortBy ?? "createdAt";
    const direction = params?.sortOrder === "asc" ? 1 : -1;
    sandboxes.sort((left, right) => {
      const leftValue = left[sortBy] ?? 0;
      const rightValue = right[sortBy] ?? 0;
      return direction * (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
    });
    return createPaginator("sandboxes", sandboxes, {
      cursor: params?.cursor,
      limit: params?.limit,
    });
  }

  private constructor(params: {
    name: string;
    persistent: boolean;
    region: string;
    vcpus: number;
    memory: number;
    runtime: string;
    routes: Route[];
    timeout: number;
    tags?: Record<string, string>;
    networkPolicy?: NetworkPolicy;
    sourceSnapshotId?: string;
    snapshotExpiration?: number;
    keepLastSnapshots?: { count: number; expiration?: number; deleteEvicted?: boolean };
    cwd: string;
    env?: Record<string, string>;
    handlers: CommandHandler[];
    onResume?: CreateParams["onResume"];
    session: Session;
  }) {
    this.#name = params.name;
    this.#persistent = params.persistent;
    this.#region = params.region;
    this.#vcpus = params.vcpus;
    this.#memory = params.memory;
    this.#runtime = params.runtime;
    this.#routes = params.routes;
    this.#timeout = params.timeout;
    this.#tags = params.tags;
    this.#networkPolicy = params.networkPolicy;
    this.#sourceSnapshotId = params.sourceSnapshotId;
    this.#snapshotExpiration = params.snapshotExpiration;
    this.#keepLastSnapshots = params.keepLastSnapshots;
    this.#cwd = params.cwd;
    this.#env = params.env;
    this.#handlers = params.handlers;
    this.#onResume = params.onResume;
    this.#sessions = [params.session];
  }

  get name(): string {
    return this.#name;
  }

  get persistent(): boolean {
    return this.#persistent;
  }

  get region(): string | undefined {
    return this.#region;
  }

  get vcpus(): number | undefined {
    return this.#vcpus;
  }

  get memory(): number | undefined {
    return this.#memory;
  }

  get runtime(): string | undefined {
    return this.#runtime;
  }

  get routes(): Route[] {
    return this.#routes;
  }

  get status():
    | "pending"
    | "running"
    | "stopping"
    | "stopped"
    | "failed"
    | "aborted"
    | "snapshotting" {
    return this.currentSession().status;
  }

  get timeout(): number | undefined {
    return this.#timeout;
  }

  get fs(): FileSystem {
    return new FileSystem(this.currentSession().fs);
  }

  get cwd(): string {
    return this.#cwd;
  }

  get expiresAt(): Date | undefined {
    const session = this.currentSession();
    if (session.status === "running") {
      const base = session.startedAt ?? session.createdAt;
      return new Date(base.getTime() + session.timeout);
    }
    return undefined;
  }

  get tags(): Record<string, string> | undefined {
    return this.#tags;
  }

  get networkPolicy(): NetworkPolicy | undefined {
    return this.#networkPolicy;
  }

  get sourceSnapshotId(): string | undefined {
    return this.#sourceSnapshotId;
  }

  get currentSnapshotId(): string | undefined {
    return this.#currentSnapshotId;
  }

  get snapshotExpiration(): number | undefined {
    return this.#snapshotExpiration;
  }

  get keepLastSnapshots():
    | { count: number; expiration?: number; deleteEvicted?: boolean }
    | undefined {
    return this.#keepLastSnapshots;
  }

  get createdAt(): Date {
    return this.#createdAt;
  }

  get updatedAt(): Date {
    return this.#updatedAt;
  }

  get statusUpdatedAt(): Date | undefined {
    return this.#statusUpdatedAt;
  }

  get interactivePort(): number | undefined {
    return undefined;
  }

  get totalEgressBytes(): number | undefined {
    return undefined;
  }

  get totalIngressBytes(): number | undefined {
    return undefined;
  }

  get totalActiveCpuDurationMs(): number | undefined {
    return undefined;
  }

  get totalDurationMs(): number | undefined {
    return undefined;
  }

  get activeCpuUsageMs(): number | undefined {
    return this.currentSession().activeCpuUsageMs;
  }

  get networkTransfer(): { ingress: number; egress: number } | undefined {
    return this.currentSession().networkTransfer;
  }

  currentSession(): Session {
    return this.#sessions.at(-1)!;
  }

  async #resume(): Promise<void> {
    const session = await createLocalSession({
      timeout: this.#timeout,
      networkPolicy: this.#networkPolicy,
      memory: this.#memory,
      vcpus: this.#vcpus,
      region: this.#region,
      runtime: this.#runtime,
      cwd: this.#cwd,
      routes: this.#routes,
      env: this.#env,
      handlers: this.#handlers,
    });

    this.#sessions.push(session);
    this.#updatedAt = new Date();
    this.#statusUpdatedAt = new Date();

    if (this.#onResume) {
      await this.#onResume(this as unknown as RealSandbox);
    }
  }

  async #ensureRunning(): Promise<Session> {
    const current = this.currentSession();
    if (current.status === "stopped") {
      this.#resumePromise ??= this.#resume().finally(() => {
        this.#resumePromise = undefined;
      });
      await this.#resumePromise;
    }
    return this.currentSession();
  }

  async getCommand(cmdId: string, opts?: { signal?: AbortSignal }): Promise<Command> {
    const session = await this.#ensureRunning();
    return session.getCommand(cmdId, opts);
  }

  async runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<CommandFinished>;
  async runCommand(params: RunCommandParams & { detached: true }): Promise<Command>;
  async runCommand(params: RunCommandParams): Promise<CommandFinished>;
  async runCommand(
    commandOrParams: string | RunCommandParams,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<Command | CommandFinished> {
    const session = await this.#ensureRunning();
    if (typeof commandOrParams === "string") {
      return session.runCommand(commandOrParams, args, opts);
    }
    return session.runCommand(commandOrParams);
  }

  async mkDir(path: string, opts?: { signal?: AbortSignal }): Promise<void> {
    const session = await this.#ensureRunning();
    return session.mkDir(path, opts);
  }

  async openInteractive(opts?: { signal?: AbortSignal }): Promise<{ url: string; token: string }> {
    const session = await this.#ensureRunning();
    return session.openInteractive(opts);
  }

  async readFile(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null> {
    const session = await this.#ensureRunning();
    return session.readFile(file, opts);
  }

  async readFileToBuffer(
    file: { path: string; cwd?: string },
    opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null> {
    const session = await this.#ensureRunning();
    return session.readFileToBuffer(file, opts);
  }

  async downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null> {
    const session = await this.#ensureRunning();
    return session.downloadFile(src, dst, opts);
  }

  async writeFiles(
    files: { path: string; content: string | Buffer | Uint8Array }[],
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const session = await this.#ensureRunning();
    return session.writeFiles(files, opts);
  }

  domain(port: number): string {
    const route = this.#routes.find((r) => r.port === port);
    if (!route) throw new Error(`No route for port ${port}`);
    return route.url;
  }

  async stop(_opts?: { signal?: AbortSignal; blocking?: boolean }): Promise<{
    id: string;
    memory: number;
    vcpus: number;
    region: string;
    runtime: string;
    timeout: number;
    status: "stopped";
    requestedAt: number;
    createdAt: number;
    cwd: string;
    updatedAt: number;
    networkPolicy?: NetworkPolicy;
    activeCpuDurationMs: number;
    networkTransfer: { ingress: number; egress: number };
  }> {
    const session = this.currentSession();
    const result = await session.stop(_opts);
    this.#updatedAt = new Date();
    this.#statusUpdatedAt = new Date();
    return result.session;
  }

  async update(
    params: {
      persistent?: boolean;
      resources?: { vcpus?: number };
      timeout?: number;
      networkPolicy?: NetworkPolicy;
      tags?: Record<string, string>;
      ports?: number[];
      snapshotExpiration?: number;
      keepLastSnapshots?: {
        count: number;
        expiration?: number;
        deleteEvicted?: boolean;
      } | null;
      currentSnapshotId?: string;
    },
    _opts?: { signal?: AbortSignal },
  ): Promise<void> {
    if (params.persistent !== undefined) this.#persistent = params.persistent;
    if (params.resources?.vcpus !== undefined) this.#vcpus = params.resources.vcpus;
    if (params.timeout !== undefined) this.#timeout = params.timeout;
    if (params.networkPolicy !== undefined) this.#networkPolicy = params.networkPolicy;
    if (params.tags !== undefined) this.#tags = params.tags;
    if (params.ports !== undefined) {
      this.#routes = params.ports.map((port) => ({
        url: `https://mock-${this.#name}-${port}.sandbox.mock`,
        subdomain: `mock-${this.#name}-${port}`,
        port,
      }));
    }
    if (params.snapshotExpiration !== undefined) {
      this.#snapshotExpiration = params.snapshotExpiration;
    }
    if (params.keepLastSnapshots !== undefined) {
      this.#keepLastSnapshots = params.keepLastSnapshots ?? undefined;
    }
    if (params.currentSnapshotId !== undefined) {
      this.#currentSnapshotId = params.currentSnapshotId;
    }
    const session = this.currentSession();
    // The new timeout is the sandbox default (applies to future sessions). The
    // running session is only extended by a positive increment — decreases do
    // not shrink a live session, matching the real SDK.
    if (params.timeout !== undefined && session.status === "running") {
      const increment = params.timeout - session.timeout;
      if (increment > 0) await session.extendTimeout(increment, _opts);
    }
    session._syncConfig({
      networkPolicy: this.#networkPolicy,
      vcpus: this.#vcpus,
      routes: this.#routes,
    });
    this.#updatedAt = new Date();
  }

  async delete(_opts?: { signal?: AbortSignal }): Promise<void> {
    const session = this.currentSession();
    if (session.status !== "stopped") {
      await session.stop();
    }
    instances.delete(this.#name);
    this.#updatedAt = new Date();
  }

  async updateNetworkPolicy(
    networkPolicy: NetworkPolicy,
    _opts?: { signal?: AbortSignal },
  ): Promise<NetworkPolicy> {
    this.#networkPolicy = networkPolicy;
    this.currentSession()._syncConfig({ networkPolicy });
    this.#updatedAt = new Date();
    return networkPolicy;
  }

  async extendTimeout(duration: number, opts?: { signal?: AbortSignal }): Promise<void> {
    const session = await this.#ensureRunning();
    // Extends the running session only; the sandbox default timeout (used for
    // future sessions) is left unchanged, matching the real SDK.
    await session.extendTimeout(duration, opts);
    this.#updatedAt = new Date();
  }

  /**
   * The user that non-`sudo` commands run as, together with that user's
   * primary group. Resolved from the sandbox (via `whoami`) and memoized.
   *
   * @internal
   */
  getDefaultUser(opts?: {
    signal?: AbortSignal;
  }): Promise<{ username: string; group: string }> {
    if (!this.#defaultUserPromise) {
      this.#defaultUserPromise = (async () => {
        const result = await this.runCommand("whoami", [], opts);
        const username = (await result.stdout()).trim() || "user";
        // just-bash has no `id`, so the primary group mirrors the username
        // (matching how `createUser` names a user's group after them).
        return { username, group: username };
      })().catch((err) => {
        this.#defaultUserPromise = undefined;
        throw err;
      });
    }
    return this.#defaultUserPromise;
  }

  /**
   * Create a new Linux user with an isolated home directory.
   *
   * @param username - Linux username (lowercase letters, digits, hyphens, underscores)
   * @param opts - Optional parameters.
   * @returns A {@link SandboxUser} instance for the created user.
   */
  async createUser(username: string, opts?: { signal?: AbortSignal }): Promise<SandboxUser> {
    validateName(username, "username");
    if (this.#users.has(username)) {
      throw new Error(`Failed to create user "${username}": user already exists`);
    }
    await this.mkDir(`/home/${username}`, opts);
    // A user created via useradd gets a primary group named after them.
    this.#users.set(username, { group: username });
    return new SandboxUser({ sandbox: this, username });
  }

  /**
   * Get a user handle without creating the user. Assumes the user already
   * exists in the sandbox.
   */
  asUser(username: "root" | (string & {})): SandboxUser {
    validateName(username, "username");
    return new SandboxUser({ sandbox: this, username });
  }

  /**
   * Create a new Linux group with a shared directory at `/shared/<groupname>`.
   */
  async createGroup(
    groupname: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ groupname: string; sharedDir: string }> {
    validateName(groupname, "group name");
    if (this.#groups.has(groupname)) {
      throw new Error(`Failed to create group "${groupname}": group already exists`);
    }
    const sharedDir = `/shared/${groupname}`;
    await this.mkDir(sharedDir, opts);
    this.#groups.set(groupname, new Set());
    return { groupname, sharedDir };
  }

  /**
   * Add a user to a group.
   */
  async addUserToGroup(
    username: string,
    groupname: string,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    validateName(username, "username");
    validateName(groupname, "group name");
    const members = this.#groups.get(groupname);
    if (!members) {
      throw new Error(
        `Failed to add "${username}" to group "${groupname}": group "${groupname}" does not exist`,
      );
    }
    // The real SDK's `usermod` fails for a nonexistent user. Besides created
    // users, `root` and the default user always exist in a real sandbox.
    if (!this.#users.has(username) && username !== "root") {
      const { username: defaultUsername } = await this.getDefaultUser(opts);
      if (username !== defaultUsername) {
        throw new Error(
          `Failed to add "${username}" to group "${groupname}": user "${username}" does not exist`,
        );
      }
    }
    members.add(username);
  }

  /**
   * Remove a user from a group.
   */
  async removeUserFromGroup(
    username: string,
    groupname: string,
    _opts?: { signal?: AbortSignal },
  ): Promise<void> {
    validateName(username, "username");
    validateName(groupname, "group name");
    const members = this.#groups.get(groupname);
    if (!members || !members.has(username)) {
      throw new Error(
        `Failed to remove "${username}" from group "${groupname}": not a member`,
      );
    }
    members.delete(username);
  }

  async snapshot(opts?: { expiration?: number; signal?: AbortSignal }): Promise<Snapshot> {
    const session = await this.#ensureRunning();
    const snapshot = await session.snapshot(opts);
    registerSnapshot(snapshot, this.#name, await captureFileSystem(session.fs));
    this.#currentSnapshotId = snapshot.snapshotId;
    this.#updatedAt = new Date();
    return snapshot;
  }

  async listSessions(_params?: {
    limit?: number;
    cursor?: string;
    sortOrder?: "asc" | "desc";
    signal?: AbortSignal;
  }): Promise<MockPaginator<"sessions", SessionMetadata>> {
    return createPaginator(
      "sessions",
      this.#sessions.map((s) => ({
        id: s.sessionId,
        memory: s.memory,
        vcpus: s.vcpus,
        region: s.region,
        runtime: s.runtime,
        timeout: s.timeout,
        status: s.status,
        requestedAt: s.requestedAt.getTime(),
        createdAt: s.createdAt.getTime(),
        cwd: s.cwd,
        updatedAt: s.updatedAt.getTime(),
        startedAt: s.startedAt?.getTime(),
        requestedStopAt: s.requestedStopAt?.getTime(),
        stoppedAt: s.stoppedAt?.getTime(),
        abortedAt: s.abortedAt?.getTime(),
        duration: s.duration,
        sourceSnapshotId: s.sourceSnapshotId,
        snapshottedAt: s.snapshottedAt?.getTime(),
        interactivePort: s.interactivePort,
        networkPolicy: s.networkPolicy,
        activeCpuDurationMs: s.activeCpuUsageMs,
        networkTransfer: s.networkTransfer,
      })),
    );
  }

  async listSnapshots(_params?: {
    limit?: number;
    cursor?: string;
    sortOrder?: "asc" | "desc";
    signal?: AbortSignal;
  }): Promise<MockPaginator<"snapshots", SnapshotMetadata>> {
    return createPaginator("snapshots", listSnapshotMetadata(this.#name));
  }
}

export { setupSandbox };
export type { SandboxServer };

/* eslint-disable no-unused-expressions */
null! as AssertExtends<PublicShape<Sandbox>, PublicShape<RealSandbox>>;
/* eslint-enable no-unused-expressions */
