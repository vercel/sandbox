import { Readable, type Writable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname, resolve, isAbsolute, join } from "path";
import type {
  SandboxMetaData,
  SandboxRouteData,
} from "../api-client/validators.js";
import type { NetworkPolicy } from "../network-policy.js";
import type { ConvertedSandbox } from "../utils/convert-sandbox.js";
import {
  MockCommand,
  MockCommandFinished,
  type MockCommandOptions,
} from "./command.js";
import type { CommandHandler, CommandResponse } from "./handlers.js";
import { MockSnapshot } from "./snapshot.js";

let defaultHandlers: CommandHandler[] = [];
let runtimeHandlers: CommandHandler[] = [];

interface RunCommandParams {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
  detached?: boolean;
  stdout?: Writable;
  stderr?: Writable;
  signal?: AbortSignal;
}

export interface MockSandboxOptions {
  sandboxId?: string;
  status?: SandboxMetaData["status"];
  timeout?: number;
  ports?: number[];
  files?: Record<string, Buffer>;
  commands?: Record<string, MockCommandOptions>;
  networkPolicy?: NetworkPolicy;
  sourceSnapshotId?: string;
  createdAt?: Date;
  runtime?: string;
  handlers?: CommandHandler[];
}

function normalizePath(p: string, cwd?: string): string {
  return isAbsolute(p) ? p : join(cwd ?? "/vercel/sandbox", p);
}

export class MockSandbox {
  public readonly routes: SandboxRouteData[];

  private _sandboxId: string;
  private _status: SandboxMetaData["status"];
  private _createdAt: Date;
  private _timeout: number;
  private _networkPolicy: NetworkPolicy | undefined;
  private _sourceSnapshotId: string | undefined;
  private _runtime: string;
  private _commands: Record<string, MockCommandOptions>;
  private _handlers: CommandHandler[];
  private _files = new Map<string, Buffer>();
  private _dirs = new Set<string>();

  get sandboxId(): string {
    return this._sandboxId;
  }

  get status(): SandboxMetaData["status"] {
    return this._status;
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get timeout(): number {
    return this._timeout;
  }

  get networkPolicy(): NetworkPolicy | undefined {
    return this._networkPolicy;
  }

  get sourceSnapshotId(): string | undefined {
    return this._sourceSnapshotId;
  }

  get activeCpuUsageMs(): number | undefined {
    return undefined;
  }

  get networkTransfer(): { ingress: number; egress: number } | undefined {
    return undefined;
  }

  get interactivePort(): number | undefined {
    return undefined;
  }

  protected constructor(opts?: MockSandboxOptions) {
    this._sandboxId =
      opts?.sandboxId ?? "sbx_" + Math.random().toString(36).slice(2);
    this._status = opts?.status ?? "running";
    this._createdAt = opts?.createdAt ?? new Date();
    this._timeout = opts?.timeout ?? 300_000;
    this._networkPolicy = opts?.networkPolicy;
    this._sourceSnapshotId = opts?.sourceSnapshotId;
    this._runtime = opts?.runtime ?? "node24";
    this._commands = opts?.commands ?? {};
    this._handlers = [
      ...runtimeHandlers,
      ...(opts?.handlers ?? []),
      ...defaultHandlers,
    ];

    this.routes = (opts?.ports ?? []).map((port) => ({
      url: `https://mock-port-${port}.vercel.run`,
      subdomain: `mock-port-${port}`,
      port,
    }));

    if (opts?.files) {
      for (const [p, buf] of Object.entries(opts.files)) {
        this._files.set(normalizePath(p), buf);
      }
    }
  }

  async getCommand(
    cmdId: string,
    _opts?: { signal?: AbortSignal },
  ): Promise<MockCommand> {
    return new MockCommand({ cmdId });
  }

  async runCommand(
    command: string,
    args?: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<MockCommandFinished>;
  async runCommand(
    params: RunCommandParams & { detached: true },
  ): Promise<MockCommand>;
  async runCommand(params: RunCommandParams): Promise<MockCommandFinished>;
  async runCommand(
    commandOrParams: string | RunCommandParams,
    args?: string[],
    _opts?: { signal?: AbortSignal },
  ): Promise<MockCommand | MockCommandFinished> {
    if (typeof commandOrParams === "string") {
      const handlerResponse = await this.resolveHandler(commandOrParams, args ?? []);
      if (handlerResponse) {
        return new MockCommandFinished({
          ...handlerResponse,
          exitCode: handlerResponse.exitCode ?? 0,
        });
      }
    }

    const params: RunCommandParams =
      typeof commandOrParams === "string"
        ? { cmd: commandOrParams, args, signal: _opts?.signal }
        : commandOrParams;

    if (typeof commandOrParams !== "string") {
      const handlerResponse = await this.resolveHandler(params.cmd, params.args ?? []);
      if (handlerResponse) {
        if (params.detached) {
          return new MockCommand({
            ...handlerResponse,
            exitCode: handlerResponse.exitCode ?? 0,
          });
        }
        return new MockCommandFinished({
          ...handlerResponse,
          exitCode: handlerResponse.exitCode ?? 0,
        });
      }
    }

    const commandOpts = this._commands[params.cmd] ?? {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };

    if (params.detached) {
      return new MockCommand(commandOpts);
    }
    return new MockCommandFinished({
      ...commandOpts,
      exitCode: commandOpts.exitCode ?? 0,
    });
  }

  private async resolveHandler(
    cmd: string,
    args: string[],
  ): Promise<CommandResponse | null> {
    for (const handler of this._handlers) {
      if (handler.matches(cmd, args)) {
        return handler.resolve(cmd, args, { stdin: "" });
      }
    }
    return null;
  }

  async mkDir(path: string, _opts?: { signal?: AbortSignal }): Promise<void> {
    this._dirs.add(normalizePath(path));
  }

  async readFile(
    file: { path: string; cwd?: string },
    _opts?: { signal?: AbortSignal },
  ): Promise<NodeJS.ReadableStream | null> {
    const fullPath = normalizePath(file.path, file.cwd);
    const buf = this._files.get(fullPath);
    if (buf === undefined) return null;
    return Readable.from(buf);
  }

  async readFileToBuffer(
    file: { path: string; cwd?: string },
    _opts?: { signal?: AbortSignal },
  ): Promise<Buffer | null> {
    const fullPath = normalizePath(file.path, file.cwd);
    return this._files.get(fullPath) ?? null;
  }

  async downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null> {
    const srcPath = normalizePath(src.path, src.cwd);
    const buf = this._files.get(srcPath);
    if (buf === undefined) return null;

    const dstPath = resolve(dst.cwd ?? "", dst.path);
    if (opts?.mkdirRecursive) {
      await mkdir(dirname(dstPath), { recursive: true });
    }
    await pipeline(Readable.from(buf), createWriteStream(dstPath), {
      signal: opts?.signal,
    });
    return dstPath;
  }

  async writeFiles(
    files: { path: string; content: Buffer; mode?: number }[],
    _opts?: { signal?: AbortSignal },
  ): Promise<void> {
    for (const file of files) {
      this._files.set(normalizePath(file.path), file.content);
    }
  }

  domain(p: number): string {
    const route = this.routes.find(({ port }) => port === p);
    if (route) return `https://${route.subdomain}.vercel.run`;
    throw new Error(`No route for port ${p}`);
  }

  async stop(
    _opts?: { signal?: AbortSignal; blocking?: boolean },
  ): Promise<ConvertedSandbox> {
    this._status = "stopped";
    const now = Date.now();
    return {
      id: this._sandboxId,
      memory: 2048,
      vcpus: 1,
      region: "iad1",
      runtime: this._runtime,
      timeout: this._timeout,
      status: "stopped",
      requestedAt: this._createdAt.getTime(),
      createdAt: this._createdAt.getTime(),
      cwd: "/vercel/sandbox",
      updatedAt: now,
      networkPolicy: this._networkPolicy,
    };
  }

  async extendTimeout(
    duration: number,
    _opts?: { signal?: AbortSignal },
  ): Promise<void> {
    this._timeout += duration;
  }

  async snapshot(
    _opts?: { expiration?: number; signal?: AbortSignal },
  ): Promise<MockSnapshot> {
    this._status = "snapshotting";
    return new MockSnapshot({ sourceSandboxId: this._sandboxId });
  }

  async updateNetworkPolicy(
    networkPolicy: NetworkPolicy,
    _opts?: { signal?: AbortSignal },
  ): Promise<NetworkPolicy> {
    this._networkPolicy = networkPolicy;
    return this._networkPolicy;
  }

  static async create(
    params?: MockSandboxOptions,
  ): Promise<MockSandbox & AsyncDisposable> {
    return new MockDisposableSandbox(params);
  }

  static async get(params?: MockSandboxOptions): Promise<MockSandbox> {
    return new MockSandbox(params);
  }

  static async list(params?: {
    sandboxes?: MockSandboxOptions[];
  }): Promise<{
    sandboxes: MockSandbox[];
    pagination: { count: number; next: number | null; prev: number | null };
  }> {
    const sandboxes = (params?.sandboxes ?? []).map(
      (opts) => new MockSandbox(opts),
    );
    return {
      sandboxes,
      pagination: {
        count: sandboxes.length,
        next: null,
        prev: null,
      },
    };
  }
}

class MockDisposableSandbox extends MockSandbox implements AsyncDisposable {
  async [Symbol.asyncDispose]() {
    await this.stop();
  }
}

export type SandboxServer = {
  use: (...handlers: CommandHandler[]) => void;
  resetHandlers: () => void;
};

export function setupSandbox(...handlers: CommandHandler[]): SandboxServer {
  defaultHandlers = handlers;
  runtimeHandlers = [];

  return {
    use(...handlers: CommandHandler[]) {
      runtimeHandlers.unshift(...handlers);
    },
    resetHandlers() {
      runtimeHandlers = [];
    },
  };
}
