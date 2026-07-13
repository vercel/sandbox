import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import type { Writable } from "node:stream";
import type { Sandbox as JustBashSandbox } from "just-bash";
import type {
  IFileSystem,
  SandboxCommand as JustBashSandboxCommand,
  SandboxCommandFinished as JustBashSandboxCommandFinished,
} from "just-bash";
import type {
  Session as RealSession,
  Command as RealCommand,
  CommandFinished as RealCommandFinished,
  NetworkPolicy,
} from "@vercel/sandbox";
import { Command, CommandFinished, createCommand, createCommandFinished } from "./command";
import type { CommandHandler, CommandResponse } from "./handlers";
import { Snapshot } from "./stubs";
import type { PublicShape, AssertExtends } from "./type-utils";

type Route = { url: string; subdomain: string; port: number };
type FileReference = { path: string; cwd?: string };

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

function hasShellOperators(command: string): boolean {
  return /[|&;<>]/.test(command);
}

export class Session {
  #sessionId: string = randomUUID();
  #status: "pending" | "running" | "stopping" | "stopped" | "failed" | "aborted" | "snapshotting" =
    "running";
  #createdAt = new Date();
  #timeout: number;
  #networkPolicy: NetworkPolicy | undefined;
  #sourceSnapshotId: string | undefined;
  #memory: number;
  #vcpus: number;
  #region: string;
  #runtime: string;
  #cwd: string;
  #routes: Route[];
  #commands = new Map<string, Command>();
  #inner: JustBashSandbox;
  #handlers: CommandHandler[];
  #updatedAt = new Date();
  #requestedAt = new Date();
  #startedAt: Date | undefined = new Date();
  #requestedStopAt: Date | undefined = undefined;
  #stoppedAt: Date | undefined = undefined;
  #abortedAt: Date | undefined = undefined;
  #snapshottedAt: Date | undefined = undefined;
  #duration: number | undefined = undefined;
  #activeCpuUsageMs: number | undefined = undefined;
  #networkTransfer: { ingress: number; egress: number } | undefined = undefined;

  constructor(params: {
    inner: JustBashSandbox;
    sessionId?: string;
    timeout: number;
    networkPolicy?: NetworkPolicy;
    sourceSnapshotId?: string;
    memory?: number;
    vcpus?: number;
    region?: string;
    runtime?: string;
    cwd: string;
    routes: Route[];
    handlers: CommandHandler[];
  }) {
    this.#inner = params.inner;
    if (params.sessionId) this.#sessionId = params.sessionId;
    this.#timeout = params.timeout;
    this.#networkPolicy = params.networkPolicy;
    this.#sourceSnapshotId = params.sourceSnapshotId;
    this.#memory = params.memory ?? 2048;
    this.#vcpus = params.vcpus ?? 1;
    this.#region = params.region ?? "mock";
    this.#runtime = params.runtime ?? "node24";
    this.#cwd = params.cwd;
    this.#routes = params.routes;
    this.#handlers = params.handlers;
  }

  async #resolveHandler(cmd: string, args: string[]): Promise<CommandResponse | null> {
    // Provide exec so handlers can delegate to just-bash
    const exec = async (execCmd: string, execArgs?: string[]) => {
      const result = execArgs
        ? await this.#inner.runCommand(execCmd, execArgs)
        : await this.#inner.runCommand(execCmd);
      return {
        stdout: await result.stdout(),
        stderr: await result.stderr(),
        exitCode: result.exitCode,
      };
    };

    for (const handler of this.#handlers) {
      if (handler.matches(cmd, args)) {
        return handler.resolve(cmd, args, { stdin: "", exec });
      }
    }
    return null;
  }

  #syntheticFinished(response: CommandResponse): JustBashSandboxCommandFinished {
    const stdout = response.stdout ?? "";
    const stderr = response.stderr ?? "";
    const exitCode = response.exitCode ?? 0;
    const obj = {
      cmdId: randomUUID(),
      cwd: this.#cwd,
      startedAt: new Date(),
      exitCode,
      async *logs() {
        if (stdout) yield { data: stdout, type: "stdout" as const };
        if (stderr) yield { data: stderr, type: "stderr" as const };
      },
      async wait() {
        return obj;
      },
      async stdout() {
        return stdout;
      },
      async stderr() {
        return stderr;
      },
      async output() {
        return stdout + stderr;
      },
      async kill() {},
    };
    return obj as unknown as JustBashSandboxCommandFinished;
  }

  #track<T extends Command>(command: T): T {
    this.#commands.set(command.cmdId, command);
    return command;
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get interactivePort(): number | undefined {
    return undefined;
  }

  get status():
    | "pending"
    | "running"
    | "stopping"
    | "stopped"
    | "failed"
    | "aborted"
    | "snapshotting" {
    return this.#status;
  }

  get createdAt(): Date {
    return this.#createdAt;
  }

  get timeout(): number {
    return this.#timeout;
  }

  get networkPolicy(): NetworkPolicy | undefined {
    return this.#networkPolicy;
  }

  get sourceSnapshotId(): string | undefined {
    return this.#sourceSnapshotId;
  }

  get memory(): number {
    return this.#memory;
  }

  get vcpus(): number {
    return this.#vcpus;
  }

  get region(): string {
    return this.#region;
  }

  get runtime(): string {
    return this.#runtime;
  }

  get cwd(): string {
    return this.#cwd;
  }

  get requestedAt(): Date {
    return this.#requestedAt;
  }

  get startedAt(): Date | undefined {
    return this.#startedAt;
  }

  get requestedStopAt(): Date | undefined {
    return this.#requestedStopAt;
  }

  get stoppedAt(): Date | undefined {
    return this.#stoppedAt;
  }

  get abortedAt(): Date | undefined {
    return this.#abortedAt;
  }

  get duration(): number | undefined {
    return this.#duration;
  }

  get snapshottedAt(): Date | undefined {
    return this.#snapshottedAt;
  }

  get updatedAt(): Date {
    return this.#updatedAt;
  }

  get activeCpuUsageMs(): number | undefined {
    return this.#activeCpuUsageMs;
  }

  get networkTransfer(): { ingress: number; egress: number } | undefined {
    return this.#networkTransfer;
  }

  get routes(): Route[] {
    return this.#routes;
  }

  get fs(): IFileSystem {
    return this.#inner.bashEnvInstance.fs;
  }

  async #readFileBytes(file: FileReference): Promise<Buffer | null> {
    const path = this.fs.resolvePath(file.cwd ?? this.#cwd, file.path);
    try {
      return Buffer.from(await this.fs.readFileBuffer(path));
    } catch {
      return null;
    }
  }

  updateRoutes(routes: Route[]): void {
    this.#routes = routes;
  }

  _syncConfig(params: {
    timeout?: number;
    networkPolicy?: NetworkPolicy;
    vcpus?: number;
    routes?: Route[];
  }): void {
    if (params.timeout !== undefined) this.#timeout = params.timeout;
    if (params.networkPolicy !== undefined) this.#networkPolicy = params.networkPolicy;
    if (params.vcpus !== undefined) this.#vcpus = params.vcpus;
    if (params.routes !== undefined) this.updateRoutes(params.routes);
    this.#updatedAt = new Date();
  }

  async getCommand(cmdId: string, _opts?: { signal?: AbortSignal }): Promise<Command> {
    const cmd = this.#commands.get(cmdId);
    if (!cmd) throw new Error(`Command ${cmdId} not found`);
    return cmd;
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
    if (typeof commandOrParams === "string") {
      const match = await this.#resolveHandler(commandOrParams, args ?? []);
      if (match) {
        return this.#track(createCommandFinished(this.#syntheticFinished(match)));
      }
      const inner = args
        ? await this.#inner.runCommand(commandOrParams, args, { signal: opts?.signal })
        : await this.#inner.runCommand(commandOrParams);
      return this.#track(createCommandFinished(inner));
    }

    const params = commandOrParams;
    const match = await this.#resolveHandler(params.cmd, params.args ?? []);
    if (match) {
      // A synthetic finished command already satisfies the just-bash Command
      // surface (CommandFinished extends Command), so a detached handler match
      // returns a Command whose logs()/wait()/stdout()/kill() all work — it is
      // simply resolved immediately, since handlers produce output up front.
      if (params.detached) {
        return this.#track(createCommand(this.#syntheticFinished(match)));
      }
      return this.#track(createCommandFinished(this.#syntheticFinished(match)));
    }

    const shouldUseStringForm = !params.args?.length && hasShellOperators(params.cmd);

    if (params.detached) {
      let inner: JustBashSandboxCommand;
      if (shouldUseStringForm) {
        inner = await this.#inner.runCommand({
          cmd: params.cmd,
          cwd: params.cwd,
          env: params.env,
          sudo: params.sudo,
          detached: true,
          stdout: params.stdout,
          stderr: params.stderr,
          signal: params.signal,
        });
      } else {
        inner = await this.#inner.runCommand({
          cmd: params.cmd,
          args: params.args,
          cwd: params.cwd,
          env: params.env,
          sudo: params.sudo,
          detached: true,
          stdout: params.stdout,
          stderr: params.stderr,
          signal: params.signal,
        });
      }
      return this.#track(createCommand(inner));
    }

    const inner: JustBashSandboxCommandFinished = shouldUseStringForm
      ? await this.#inner.runCommand(params.cmd, {
          cwd: params.cwd,
          env: params.env,
        })
      : await this.#inner.runCommand({
          cmd: params.cmd,
          args: params.args,
          cwd: params.cwd,
          env: params.env,
          sudo: params.sudo,
          stdout: params.stdout,
          stderr: params.stderr,
          signal: params.signal,
        });

    return this.#track(createCommandFinished(inner));
  }

  async mkDir(path: string, _opts?: { signal?: AbortSignal }): Promise<void> {
    await this.#inner.mkDir(path, { recursive: true });
  }

  async openInteractive(_opts?: { signal?: AbortSignal }): Promise<{ url: string; token: string }> {
    return {
      url: `wss://mock-${this.#sessionId}.sandbox.mock/interactive`,
      token: randomUUID(),
    };
  }

  async readFile(
    file: FileReference,
    _opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null> {
    const content = await this.#readFileBytes(file);
    return content ? Readable.from([content]) : null;
  }

  async readFileToBuffer(
    file: FileReference,
    _opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null> {
    return this.#readFileBytes(file);
  }

  async downloadFile(
    src: FileReference,
    dst: FileReference,
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null>;
  async downloadFile(
    src: FileReference | string,
    dst: FileReference | string,
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null> {
    const normalizedSrc = typeof src === "string" ? { path: src } : src;
    const normalizedDst = typeof dst === "string" ? { path: dst } : dst;
    const dstPath = normalizedDst.cwd
      ? resolve(normalizedDst.cwd, normalizedDst.path)
      : resolve(normalizedDst.path);
    const content = await this.#readFileBytes(normalizedSrc);
    if (!content) return null;
    try {
      if (opts?.mkdirRecursive) {
        await mkdir(dirname(dstPath), { recursive: true });
      }
      await writeFile(dstPath, content, { signal: opts?.signal });
      return dstPath;
    } catch {
      return null;
    }
  }

  async writeFiles(
    files: { path: string; content: string | Buffer | Uint8Array }[],
    _opts?: { signal?: AbortSignal },
  ): Promise<void> {
    for (const file of files) {
      const path = this.fs.resolvePath(this.#cwd, file.path);
      await this.fs.writeFile(path, file.content);
    }
  }

  domain(port: number): string {
    const route = this.#routes.find((r) => r.port === port);
    if (!route) throw new Error(`No route for port ${port}`);
    return route.url;
  }

  async stop(_opts?: { signal?: AbortSignal; blocking?: boolean }): Promise<{
    session: {
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
    };
  }> {
    this.#status = "stopped";
    this.#stoppedAt = new Date();
    this.#requestedStopAt = this.#stoppedAt;
    this.#duration = this.#stoppedAt.getTime() - this.#createdAt.getTime();
    this.#activeCpuUsageMs = 0;
    this.#networkTransfer = { ingress: 0, egress: 0 };
    this.#updatedAt = new Date();
    await this.#inner.stop();
    return {
      session: {
        id: this.sessionId,
        memory: this.#memory,
        vcpus: this.#vcpus,
        region: this.#region,
        runtime: this.#runtime,
        timeout: this.timeout,
        status: "stopped",
        requestedAt: this.#requestedAt.getTime(),
        createdAt: this.createdAt.getTime(),
        cwd: this.#cwd,
        updatedAt: this.#updatedAt.getTime(),
        networkPolicy: this.networkPolicy,
        activeCpuDurationMs: 0,
        networkTransfer: { ingress: 0, egress: 0 },
      },
    };
  }

  async update(
    params: { networkPolicy?: NetworkPolicy },
    _opts?: { signal?: AbortSignal },
  ): Promise<void> {
    if (params.networkPolicy !== undefined) {
      this.#networkPolicy = params.networkPolicy;
    }
    this.#updatedAt = new Date();
  }

  async extendTimeout(duration: number, _opts?: { signal?: AbortSignal }): Promise<void> {
    this.#timeout += duration;
    this.#updatedAt = new Date();
  }

  async snapshot(_opts?: { expiration?: number; signal?: AbortSignal }): Promise<Snapshot> {
    this.#snapshottedAt = new Date();
    return new Snapshot(randomUUID(), this.sessionId);
  }
}

/* eslint-disable no-unused-expressions */
null! as AssertExtends<PublicShape<Session>, PublicShape<RealSession>>;
null! as AssertExtends<PublicShape<Command>, PublicShape<RealCommand>>;
null! as AssertExtends<PublicShape<CommandFinished>, PublicShape<RealCommandFinished>>;
/* eslint-enable no-unused-expressions */
