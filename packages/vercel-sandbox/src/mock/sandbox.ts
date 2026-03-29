import { Readable } from "stream";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve, isAbsolute, join } from "path";
import { Bash, type IFileSystem } from "just-bash";
import type { SandboxMetaData, SandboxRouteData, PaginationData } from "../api-client/validators.js";
import type { RunCommandParams } from "../sandbox.js";
import type { NetworkPolicy } from "../network-policy.js";
import { MockCommand, MockCommandFinished } from "./command.js";
import type { CommandHandler, CommandResponse } from "./handlers.js";
import { MockSnapshot } from "./snapshot.js";

type SandboxStatus = SandboxMetaData["status"];

const CWD = "/vercel/sandbox";

const handlerState = {
  defaults: [] as CommandHandler[],
  runtime: [] as CommandHandler[],
};

export interface MockSandboxOptions {
  sandboxId?: string;
  status?: SandboxStatus;
  timeout?: number;
  ports?: number[];
  files?: Record<string, string | Uint8Array>;
  networkPolicy?: NetworkPolicy;
  sourceSnapshotId?: string;
  createdAt?: Date;
  handlers?: CommandHandler[];
}

function normalizePath(p: string, cwd?: string): string {
  return isAbsolute(p) ? p : join(cwd ?? CWD, p);
}

export class MockSandbox {
  readonly sandboxId: string;
  readonly createdAt: Date;
  readonly sourceSnapshotId: string | undefined;
  readonly routes: SandboxRouteData[];

  status: SandboxStatus;
  timeout: number;
  networkPolicy: NetworkPolicy | undefined;

  /** The in-memory filesystem backing this sandbox. */
  get fs(): IFileSystem {
    return this._bash.fs;
  }

  get interactivePort(): number | undefined {
    return undefined;
  }

  get activeCpuUsageMs(): number | undefined {
    return undefined;
  }

  get networkTransfer(): { ingress: number; egress: number } | undefined {
    return undefined;
  }

  private _instanceHandlers: CommandHandler[];
  private _bash: Bash;

  protected constructor(opts?: MockSandboxOptions) {
    this.sandboxId = opts?.sandboxId ?? "sbx_" + Math.random().toString(36).slice(2);
    this.status = opts?.status ?? "running";
    this.createdAt = opts?.createdAt ?? new Date();
    this.timeout = opts?.timeout ?? 300_000;
    this.networkPolicy = opts?.networkPolicy;
    this.sourceSnapshotId = opts?.sourceSnapshotId;
    this._instanceHandlers = opts?.handlers ?? [];

    const seedFiles: Record<string, string | Uint8Array> = {};
    if (opts?.files) {
      for (const [p, content] of Object.entries(opts.files)) {
        seedFiles[normalizePath(p)] = content;
      }
    }
    this._bash = new Bash({ cwd: CWD, files: seedFiles });

    this.routes = (opts?.ports ?? []).map((port) => ({
      url: `https://mock-port-${port}.vercel.run`,
      subdomain: `mock-port-${port}`,
      port,
    }));
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
    const params: RunCommandParams =
      typeof commandOrParams === "string"
        ? { cmd: commandOrParams, args, signal: _opts?.signal }
        : commandOrParams;

    const handlerResponse = await this.resolveHandler(
      params.cmd,
      params.args ?? [],
    );
    if (handlerResponse) {
      if (params.stdout && handlerResponse.stdout)
        params.stdout.write(handlerResponse.stdout);
      if (params.stderr && handlerResponse.stderr)
        params.stderr.write(handlerResponse.stderr);

      if (params.detached) return new MockCommand(handlerResponse);
      return new MockCommandFinished({
        ...handlerResponse,
        exitCode: handlerResponse.exitCode ?? 0,
      });
    }

    const result = await this._bash.exec(params.cmd, {
      args: params.args,
      cwd: params.cwd,
      env: params.env,
      signal: params.signal,
    });

    if (params.stdout && result.stdout) params.stdout.write(result.stdout);
    if (params.stderr && result.stderr) params.stderr.write(result.stderr);

    const cmdOpts = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };

    if (params.detached) return new MockCommand(cmdOpts);
    return new MockCommandFinished(cmdOpts);
  }

  private async resolveHandler(
    cmd: string,
    args: string[],
  ): Promise<CommandResponse | null> {
    const handlers = [
      ...handlerState.runtime,
      ...this._instanceHandlers,
      ...handlerState.defaults,
    ];
    for (const handler of handlers) {
      if (handler.matches(cmd, args)) {
        return handler.resolve(cmd, args);
      }
    }
    return null;
  }

  async mkDir(path: string): Promise<void> {
    await this._bash.fs.mkdir(normalizePath(path), { recursive: true });
  }

  async readFile(
    file: { path: string; cwd?: string },
  ): Promise<NodeJS.ReadableStream | null> {
    const fullPath = normalizePath(file.path, file.cwd);
    if (!(await this._bash.fs.exists(fullPath))) return null;
    const data = await this._bash.fs.readFileBuffer(fullPath);
    return Readable.from(Buffer.from(data));
  }

  async readFileToBuffer(
    file: { path: string; cwd?: string },
  ): Promise<Buffer | null> {
    const fullPath = normalizePath(file.path, file.cwd);
    if (!(await this._bash.fs.exists(fullPath))) return null;
    return Buffer.from(await this._bash.fs.readFileBuffer(fullPath));
  }

  async downloadFile(
    src: { path: string; cwd?: string },
    dst: { path: string; cwd?: string },
    opts?: { mkdirRecursive?: boolean; signal?: AbortSignal },
  ): Promise<string | null> {
    const srcPath = normalizePath(src.path, src.cwd);
    if (!(await this._bash.fs.exists(srcPath))) return null;
    const data = await this._bash.fs.readFileBuffer(srcPath);

    const dstPath = resolve(dst.cwd ?? "", dst.path);
    if (opts?.mkdirRecursive) {
      await mkdir(dirname(dstPath), { recursive: true });
    }
    await writeFile(dstPath, data, { signal: opts?.signal });
    return dstPath;
  }

  async writeFiles(
    files: { path: string; content: string | Uint8Array; mode?: number }[],
  ): Promise<void> {
    for (const file of files) {
      const fullPath = normalizePath(file.path);
      const dir = dirname(fullPath);
      if (!(await this._bash.fs.exists(dir))) {
        await this._bash.fs.mkdir(dir, { recursive: true });
      }
      await this._bash.fs.writeFile(fullPath, file.content);
      if (file.mode !== undefined) {
        await this._bash.fs.chmod(fullPath, file.mode);
      }
    }
  }

  domain(p: number): string {
    const route = this.routes.find(({ port }) => port === p);
    if (route) return `https://${route.subdomain}.vercel.run`;
    throw new Error(`No route for port ${p}`);
  }

  async stop(_opts?: { signal?: AbortSignal; blocking?: boolean }) {
    this.status = "stopped";
    return {
      id: this.sandboxId,
      memory: 2048,
      vcpus: 1,
      region: "iad1",
      runtime: "node24",
      timeout: this.timeout,
      status: this.status,
      requestedAt: this.createdAt.getTime(),
      createdAt: this.createdAt.getTime(),
      cwd: CWD,
      updatedAt: Date.now(),
      sourceSnapshotId: this.sourceSnapshotId,
      networkPolicy: this.networkPolicy,
    };
  }

  async extendTimeout(duration: number): Promise<void> {
    this.timeout += duration;
  }

  async snapshot(): Promise<MockSnapshot> {
    return new MockSnapshot({ sourceSandboxId: this.sandboxId });
  }

  async updateNetworkPolicy(networkPolicy: NetworkPolicy): Promise<NetworkPolicy> {
    this.networkPolicy = networkPolicy;
    return this.networkPolicy;
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
  }): Promise<{ sandboxes: MockSandbox[]; pagination: PaginationData }> {
    const sandboxes = (params?.sandboxes ?? []).map(
      (opts) => new MockSandbox(opts),
    );
    return {
      sandboxes,
      pagination: { count: sandboxes.length, next: null, prev: null },
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
  handlerState.defaults = handlers;
  handlerState.runtime = [];

  return {
    use(...handlers: CommandHandler[]) {
      handlerState.runtime.unshift(...handlers);
    },
    resetHandlers() {
      handlerState.runtime = [];
    },
  };
}
