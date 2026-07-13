import { randomUUID } from "node:crypto";
import { Executor } from "./executor.js";
import { handlersToCustomCommands } from "../handlers.js";
import type { CommandHandler } from "../handlers.js";
import { apiError, empty, json } from "./http.js";
import { ndjson } from "./ndjson.js";
import { extractTarGz } from "./tar.js";
import { captureFileSystem, restoreFileSystem } from "./snapshot-fs.js";
import {
  commandPayload,
  routesPayload,
  sandboxPayload,
  sessionPayload,
  snapshotPayload,
} from "./payloads.js";
import {
  createUserState,
  type CommandRecord,
  type SandboxRecord,
  type SessionRecord,
  type SnapshotFileEntry,
  type SnapshotRecord,
} from "./registry.js";

const DEFAULT_CWD = "/vercel/sandbox";
const REGION = "iad1";

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

interface CreateBody {
  name?: string;
  ports?: number[];
  timeout?: number;
  resources?: { vcpus?: number };
  runtime?: string;
  persistent?: boolean;
  networkPolicy?: unknown;
  env?: Record<string, string>;
  tags?: Record<string, string>;
  snapshotExpiration?: number;
  keepLastSnapshots?: { count: number; expiration?: number; deleteEvicted?: boolean };
  source?: { type: "git" | "tarball" | "snapshot"; snapshotId?: string };
}

/**
 * A stateful in-memory implementation of the Vercel `/v2/sandboxes` HTTP API,
 * backed by just-bash. Inject {@link MockServer.fetch} into the real
 * `@vercel/sandbox` SDK and every operation runs locally — no network, no
 * credentials, no provisioning.
 */
export class MockServer {
  readonly credentials = {
    // A non-JWT token so the SDK never attempts an OIDC refresh.
    token: "mock-sandbox-token",
    teamId: "mock-team",
    projectId: "mock-project",
  };

  #sandboxes = new Map<string, SandboxRecord>();
  #sessions = new Map<string, SessionRecord>();
  #snapshots = new Map<string, SnapshotRecord>();
  #commands = new Map<string, CommandRecord>();
  /** FS persisted across stop→resume, keyed by sandbox name. */
  #disks = new Map<string, SnapshotFileEntry[]>();

  #defaultHandlers: CommandHandler[] = [];
  #runtimeHandlers: CommandHandler[] = [];

  /** A `fetch` drop-in that serves the `/v2/sandboxes` API from memory. */
  readonly fetch: typeof globalThis.fetch = (input, init) => this.#handle(input, init);

  /** Handlers applied to every sandbox created afterwards (see `setupSandbox`). */
  setDefaultHandlers(handlers: CommandHandler[]): void {
    this.#defaultHandlers = handlers;
  }

  /** Prepend one-off handlers (see the `use` method of `setupSandbox`). */
  use(handlers: CommandHandler[]): void {
    this.#runtimeHandlers.unshift(...handlers);
  }

  /** Reset all in-memory state — sandboxes, snapshots, and runtime handlers. */
  reset(): void {
    this.#sandboxes.clear();
    this.#sessions.clear();
    this.#snapshots.clear();
    this.#commands.clear();
    this.#disks.clear();
    this.#runtimeHandlers = [];
  }

  async #handle(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const segments = url.pathname.replace(/^\/api/, "").split("/").filter(Boolean);
    // Expect ["v2", "sandboxes", ...rest]
    const rest = segments.slice(2);

    if (rest[0] === "sessions") return this.#sessionRoutes(method, rest.slice(1), url, init);
    if (rest[0] === "snapshots") return this.#snapshotRoutes(method, rest.slice(1), url);
    if (rest.length === 0) {
      if (method === "POST") return this.#createSandbox(init);
      if (method === "GET") return this.#listSandboxes(url);
    }
    // /v2/sandboxes/:name
    const name = decodeURIComponent(rest[0]);
    if (method === "GET") return this.#getSandbox(name, url);
    if (method === "PATCH") return this.#updateSandbox(name, init);
    if (method === "DELETE") return this.#deleteSandbox(name);

    return apiError(404, "not_found", `No route for ${method} ${url.pathname}`);
  }

  // ---- sandbox lifecycle ---------------------------------------------------

  async #createSandbox(init?: RequestInit): Promise<Response> {
    const body = readJson<CreateBody>(init);
    const name = body.name ?? `sandbox-${randomUUID()}`;
    const ports = body.ports ?? [];

    const record: SandboxRecord = {
      name,
      persistent: body.persistent ?? false,
      region: REGION,
      vcpus: body.resources?.vcpus ?? 2,
      memory: 2048,
      runtime: body.runtime ?? "node22",
      timeout: body.timeout ?? 300_000,
      tags: body.tags,
      networkPolicy: body.networkPolicy,
      cwd: DEFAULT_CWD,
      env: body.env,
      ports,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      snapshotExpiration: body.snapshotExpiration,
      keepLastSnapshots: body.keepLastSnapshots,
      sessionId: "",
      users: createUserState(),
    };

    let restore: SnapshotFileEntry[] | undefined;
    if (body.source?.type === "snapshot" && body.source.snapshotId) {
      const snapshot = this.#snapshots.get(body.source.snapshotId);
      if (!snapshot || snapshot.status === "deleted") {
        return apiError(410, "snapshot_not_found", `Snapshot not found: ${body.source.snapshotId}`);
      }
      restore = snapshot.files;
      record.sourceSnapshotId = snapshot.id;
    }

    const session = await this.#startSession(record, {
      sourceSnapshotId: record.sourceSnapshotId,
      restore,
    });
    this.#sandboxes.set(name, record);

    return json({
      sandbox: sandboxPayload(record, session),
      session: sessionPayload(session),
      routes: routesPayload(name, ports),
      resumed: false,
    });
  }

  async #getSandbox(name: string, url: URL): Promise<Response> {
    const record = this.#sandboxes.get(name);
    if (!record) return apiError(404, "not_found", `Sandbox not found: ${name}`);

    let session = this.#sessions.get(record.sessionId)!;
    let resumed = false;
    if (url.searchParams.get("resume") === "true" && session.status !== "running") {
      session = await this.#startSession(record, { restore: this.#disks.get(name) });
      resumed = true;
    }

    return json({
      sandbox: sandboxPayload(record, session),
      session: sessionPayload(session),
      routes: routesPayload(name, record.ports),
      resumed,
    });
  }

  #listSandboxes(url: URL): Response {
    const namePrefix = url.searchParams.get("namePrefix") ?? undefined;
    const tags = url.searchParams.getAll("tags");
    const limit = Number(url.searchParams.get("limit") ?? "0") || undefined;

    let records = [...this.#sandboxes.values()];
    if (namePrefix) records = records.filter((r) => r.name.startsWith(namePrefix));
    if (tags.length > 0) {
      records = records.filter((r) =>
        tags.every((tag) => {
          const [key, value] = tag.split(":");
          return r.tags?.[key] === value;
        }),
      );
    }
    const sortOrder = url.searchParams.get("sortOrder") === "asc" ? 1 : -1;
    records.sort((a, b) => sortOrder * (a.createdAt - b.createdAt));
    const page = limit ? records.slice(0, limit) : records;

    return json({
      sandboxes: page.map((r) => sandboxPayload(r, this.#sessions.get(r.sessionId)!)),
      pagination: { count: page.length, next: null },
    });
  }

  async #updateSandbox(name: string, init?: RequestInit): Promise<Response> {
    const record = this.#sandboxes.get(name);
    if (!record) return apiError(404, "not_found", `Sandbox not found: ${name}`);
    const body = readJson<CreateBody & { currentSnapshotId?: string }>(init);
    const session = this.#sessions.get(record.sessionId)!;

    if (body.persistent !== undefined) record.persistent = body.persistent;
    if (body.resources?.vcpus !== undefined) {
      record.vcpus = body.resources.vcpus;
      session.vcpus = body.resources.vcpus;
    }
    if (body.runtime !== undefined) record.runtime = body.runtime;
    if (body.timeout !== undefined) {
      record.timeout = body.timeout;
      if (session.status === "running" && body.timeout > session.timeout) {
        session.timeout = body.timeout;
      }
    }
    if (body.networkPolicy !== undefined) {
      record.networkPolicy = body.networkPolicy;
      session.networkPolicy = body.networkPolicy;
    }
    if (body.tags !== undefined) record.tags = body.tags;
    if (body.snapshotExpiration !== undefined) record.snapshotExpiration = body.snapshotExpiration;
    if (body.keepLastSnapshots !== undefined) {
      record.keepLastSnapshots = body.keepLastSnapshots ?? undefined;
    }
    if (body.currentSnapshotId !== undefined) record.currentSnapshotId = body.currentSnapshotId;

    let routes: ReturnType<typeof routesPayload> | undefined;
    if (body.ports !== undefined) {
      record.ports = body.ports;
      routes = routesPayload(name, body.ports);
    }
    record.updatedAt = Date.now();
    session.updatedAt = Date.now();

    return json({ sandbox: sandboxPayload(record, session), routes });
  }

  async #deleteSandbox(name: string): Promise<Response> {
    const record = this.#sandboxes.get(name);
    if (!record) return apiError(404, "not_found", `Sandbox not found: ${name}`);
    const session = this.#sessions.get(record.sessionId)!;
    if (session.status === "running") {
      session.status = "stopped";
      session.stoppedAt = Date.now();
      await session.executor.stop();
    }
    this.#sandboxes.delete(name);
    this.#disks.delete(name);
    return json({ sandbox: sandboxPayload(record, session) });
  }

  // ---- sessions ------------------------------------------------------------

  async #sessionRoutes(
    method: string,
    parts: string[],
    url: URL,
    init?: RequestInit,
  ): Promise<Response> {
    // /v2/sandboxes/sessions (list)
    if (parts.length === 0) return this.#listSessions(url);

    const sessionId = parts[0];
    const sub = parts.slice(1);
    const session = this.#sessions.get(sessionId);
    if (!session) return apiError(404, "not_found", `Session not found: ${sessionId}`);

    if (sub.length === 0 && method === "GET") {
      return json({
        session: sessionPayload(session),
        routes: routesPayload(session.sandboxName, this.#sandboxes.get(session.sandboxName)!.ports),
      });
    }

    switch (sub[0]) {
      case "stop":
        return this.#stopSession(session);
      case "network-policy":
        return this.#updateNetworkPolicy(session, init);
      case "extend-timeout":
        return this.#extendTimeout(session, init);
      case "interactive":
        return json({ url: `wss://${sessionId}.mock.vercel.run/interactive`, token: newId("tok") });
      case "snapshot":
        return this.#createSnapshot(session, init);
      case "cmd":
        return this.#cmdRoutes(method, session, sub.slice(1), url, init);
      case "fs":
        return this.#fsRoutes(session, sub[1], init);
    }
    return apiError(404, "not_found", `No route for ${method} ${url.pathname}`);
  }

  #listSessions(url: URL): Response {
    const name = url.searchParams.get("name") ?? undefined;
    const sessions = [...this.#sandboxes.values()]
      .filter((r) => !name || r.name === name)
      .map((r) => sessionPayload(this.#sessions.get(r.sessionId)!));
    return json({ sessions, pagination: { count: sessions.length, next: null } });
  }

  async #stopSession(session: SessionRecord): Promise<Response> {
    if (session.status === "running") {
      // Persist the disk so a later resume restores it.
      this.#disks.set(session.sandboxName, await captureFileSystem(session.executor.fs));
      session.status = "stopped";
      session.stoppedAt = Date.now();
      session.requestedStopAt = session.stoppedAt;
      session.duration = session.stoppedAt - session.createdAt;
      session.activeCpuDurationMs = 0;
      session.networkTransfer = { ingress: 0, egress: 0 };
      session.updatedAt = Date.now();
      await session.executor.stop();
    }
    const record = this.#sandboxes.get(session.sandboxName);
    return json({
      session: sessionPayload(session),
      sandbox: record ? sandboxPayload(record, session) : undefined,
    });
  }

  #updateNetworkPolicy(session: SessionRecord, init?: RequestInit): Response {
    session.networkPolicy = readJson(init);
    const record = this.#sandboxes.get(session.sandboxName);
    if (record) record.networkPolicy = session.networkPolicy;
    session.updatedAt = Date.now();
    return json({ session: sessionPayload(session) });
  }

  #extendTimeout(session: SessionRecord, init?: RequestInit): Response {
    const { duration } = readJson<{ duration: number }>(init);
    session.timeout += duration;
    session.updatedAt = Date.now();
    return json({ session: sessionPayload(session) });
  }

  async #createSnapshot(session: SessionRecord, init?: RequestInit): Promise<Response> {
    const body = readJson<{ expiration?: number }>(init);
    const files = await captureFileSystem(session.executor.fs);
    const record = this.#sandboxes.get(session.sandboxName)!;
    const snapshot: SnapshotRecord = {
      id: newId("snap"),
      sandboxName: session.sandboxName,
      sourceSessionId: session.id,
      region: session.region,
      status: "created",
      sizeBytes: files.reduce((n, f) => n + (f.type === "file" ? f.content.length : 0), 0),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: body.expiration ? Date.now() + body.expiration : undefined,
      parentId: record.currentSnapshotId,
      files,
    };
    this.#snapshots.set(snapshot.id, snapshot);
    session.snapshottedAt = Date.now();
    record.currentSnapshotId = snapshot.id;
    record.updatedAt = Date.now();
    return json({ snapshot: snapshotPayload(snapshot), session: sessionPayload(session) });
  }

  // ---- commands ------------------------------------------------------------

  async #cmdRoutes(
    method: string,
    session: SessionRecord,
    sub: string[],
    url: URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (sub.length === 0 && method === "POST") return this.#runCommand(session, init);

    const cmdId = sub[0];
    if (sub[1] === "kill" && method === "POST") {
      const command = this.#commands.get(cmdId);
      if (!command) return apiError(404, "not_found", `Command not found: ${cmdId}`);
      return json({ command: commandPayload(command) });
    }
    if (sub[1] === "logs" && method === "GET") {
      const command = this.#commands.get(cmdId);
      if (!command) return apiError(404, "not_found", `Command not found: ${cmdId}`);
      return ndjson(logLines(command));
    }
    if (sub.length === 1 && method === "GET") {
      const command = this.#commands.get(cmdId);
      if (!command) return apiError(404, "not_found", `Command not found: ${cmdId}`);
      const finished = url.searchParams.get("wait") === "true";
      return json({ command: commandPayload(command, { finished }) });
    }
    return apiError(404, "not_found", `No route for ${method} ${url.pathname}`);
  }

  async #runCommand(session: SessionRecord, init?: RequestInit): Promise<Response> {
    if (session.status !== "running") {
      return apiError(410, "sandbox_stopped", "Sandbox is stopped");
    }
    const body = readJson<{
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      sudo?: boolean;
      wait?: boolean;
      logs?: boolean;
    }>(init);

    const result = await session.executor.run({
      command: body.command,
      args: body.args ?? [],
      cwd: body.cwd,
      env: body.env,
      sudo: body.sudo,
    });

    const command: CommandRecord = {
      id: newId("cmd"),
      sessionId: session.id,
      name: body.command,
      args: body.args ?? [],
      cwd: body.cwd ?? session.cwd,
      startedAt: result.startedAt,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    this.#commands.set(command.id, command);

    if (!body.wait) {
      // Detached: report the (already finished) command as a plain JSON body.
      return json({ command: commandPayload(command) });
    }

    // wait: stream command chunk → optional logs → finished chunk as NDJSON.
    const lines: unknown[] = [{ command: { ...commandPayload(command), exitCode: null } }];
    if (body.logs) lines.push(...logLines(command));
    lines.push({ command: commandPayload(command, { finished: true }) });
    return ndjson(lines);
  }

  // ---- filesystem ----------------------------------------------------------

  async #fsRoutes(session: SessionRecord, op: string, init?: RequestInit): Promise<Response> {
    if (session.status !== "running") {
      return apiError(410, "sandbox_stopped", "Sandbox is stopped");
    }
    const fs = session.executor.fs;

    if (op === "mkdir") {
      const { path, cwd } = readJson<{ path: string; cwd?: string }>(init);
      await fs.mkdir(fs.resolvePath(cwd ?? session.cwd, path), { recursive: true });
      return empty();
    }

    if (op === "write") {
      const extractDir = getHeader(init, "x-cwd") ?? "/";
      const entries = await extractTarGz(toBuffer(init?.body));
      for (const entry of entries) {
        const abs = fs.resolvePath(extractDir, entry.name);
        const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(abs, entry.content);
        if (entry.mode !== undefined) await fs.chmod(abs, entry.mode);
      }
      return empty();
    }

    if (op === "read") {
      const { path, cwd } = readJson<{ path: string; cwd?: string }>(init);
      const abs = fs.resolvePath(cwd ?? session.cwd, path);
      if (!(await fs.exists(abs))) return new Response(null, { status: 404 });
      const bytes = Buffer.from(await fs.readFileBuffer(abs));
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }

    return apiError(404, "not_found", `No filesystem op: ${op}`);
  }

  // ---- snapshots -----------------------------------------------------------

  #snapshotRoutes(method: string, parts: string[], url: URL): Response {
    if (parts.length === 0 && method === "GET") return this.#listSnapshots(url);
    if (parts[0] === "tree" && method === "GET") return this.#snapshotTree(url);

    const snapshotId = parts[0];
    const snapshot = this.#snapshots.get(snapshotId);
    if (!snapshot) return apiError(404, "not_found", `Snapshot not found: ${snapshotId}`);
    if (method === "GET") return json({ snapshot: snapshotPayload(snapshot) });
    if (method === "DELETE") {
      snapshot.status = "deleted";
      snapshot.updatedAt = Date.now();
      return json({ snapshot: snapshotPayload(snapshot) });
    }
    return apiError(404, "not_found", `No route for ${method} ${url.pathname}`);
  }

  #listSnapshots(url: URL): Response {
    const name = url.searchParams.get("name") ?? undefined;
    const snapshots = [...this.#snapshots.values()]
      .filter((s) => !name || s.sandboxName === name)
      .map(snapshotPayload);
    return json({ snapshots, pagination: { count: snapshots.length, next: null } });
  }

  #snapshotTree(url: URL): Response {
    const snapshotId = url.searchParams.get("snapshotId") ?? "";
    const snapshot = this.#snapshots.get(snapshotId);
    if (!snapshot) return apiError(404, "not_found", `Snapshot not found: ${snapshotId}`);
    const node = { snapshot: snapshotPayload(snapshot), siblings: [], count: "1" };
    return json({ snapshots: [node], anchor: node, pagination: { count: 1, next: null } });
  }

  // ---- helpers -------------------------------------------------------------

  async #startSession(
    record: SandboxRecord,
    opts?: { sourceSnapshotId?: string; restore?: SnapshotFileEntry[] },
  ): Promise<SessionRecord> {
    const executor = await Executor.create({
      cwd: record.cwd,
      env: record.env,
      users: record.users,
      customCommands: handlersToCustomCommands([
        ...this.#runtimeHandlers,
        ...this.#defaultHandlers,
      ]),
    });
    if (opts?.restore) await restoreFileSystem(opts.restore, executor.fs);

    const now = Date.now();
    const session: SessionRecord = {
      id: newId("se"),
      sandboxName: record.name,
      status: "running",
      timeout: record.timeout,
      networkPolicy: record.networkPolicy,
      memory: record.memory,
      vcpus: record.vcpus,
      region: record.region,
      runtime: record.runtime,
      cwd: record.cwd,
      sourceSnapshotId: opts?.sourceSnapshotId,
      createdAt: now,
      requestedAt: now,
      startedAt: now,
      updatedAt: now,
      executor,
    };
    this.#sessions.set(session.id, session);
    record.sessionId = session.id;
    record.statusUpdatedAt = now;
    return session;
  }
}

/** Render a finished command's buffered output as NDJSON log lines. */
function logLines(command: CommandRecord): unknown[] {
  const lines: unknown[] = [];
  if (command.stdout) lines.push({ stream: "stdout", data: command.stdout });
  if (command.stderr) lines.push({ stream: "stderr", data: command.stderr });
  return lines;
}

function readJson<T = Record<string, unknown>>(init?: RequestInit): T {
  const body = init?.body;
  if (body == null || body === "") return {} as T;
  return JSON.parse(typeof body === "string" ? body : String(body)) as T;
}

function toBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.from([]);
}

function getHeader(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}
