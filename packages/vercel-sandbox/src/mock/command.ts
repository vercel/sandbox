import type { Signal } from "../utils/resolveSignal.js";

type LogLine = { stream: "stdout" | "stderr"; data: string };

export interface MockCommandOptions {
  cmdId?: string;
  cwd?: string;
  startedAt?: number;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  logs?: LogLine[];
}

export class MockCommand {
  public exitCode: number | null;

  private readonly _cmdId: string;
  private readonly _cwd: string;
  private readonly _startedAt: number;
  private readonly _stdout: string;
  private readonly _stderr: string;
  private readonly _logs: LogLine[];

  get cmdId() {
    return this._cmdId;
  }

  get cwd() {
    return this._cwd;
  }

  get startedAt() {
    return this._startedAt;
  }

  constructor(opts: MockCommandOptions = {}) {
    this._cmdId = opts.cmdId ?? "cmd_" + Math.random().toString(36).slice(2);
    this._cwd = opts.cwd ?? "/";
    this._startedAt = opts.startedAt ?? Date.now();
    this.exitCode = opts.exitCode ?? null;
    this._stdout = opts.stdout ?? "";
    this._stderr = opts.stderr ?? "";
    this._logs = opts.logs ?? [];
  }

  logs(
    _opts?: { signal?: AbortSignal },
  ): AsyncGenerator<LogLine, void, void> &
    Disposable & { close(): void } {
    const items = this._logs;
    async function* gen() {
      for (const item of items) {
        yield item;
      }
    }
    const generator = gen();
    return Object.assign(generator, {
      [Symbol.dispose]() {},
      close() {},
    });
  }

  async wait(
    _params?: { signal?: AbortSignal },
  ): Promise<MockCommandFinished> {
    return new MockCommandFinished({
      cmdId: this._cmdId,
      cwd: this._cwd,
      startedAt: this._startedAt,
      exitCode: this.exitCode ?? 0,
      stdout: this._stdout,
      stderr: this._stderr,
      logs: this._logs,
    });
  }

  async output(
    stream: "stdout" | "stderr" | "both" = "both",
    _opts?: { signal?: AbortSignal },
  ): Promise<string> {
    if (stream === "stdout") return this._stdout;
    if (stream === "stderr") return this._stderr;
    return this._stdout + this._stderr;
  }

  async stdout(_opts?: { signal?: AbortSignal }): Promise<string> {
    return this.output("stdout", _opts);
  }

  async stderr(_opts?: { signal?: AbortSignal }): Promise<string> {
    return this.output("stderr", _opts);
  }

  async kill(
    _signal?: Signal,
    _opts?: { abortSignal?: AbortSignal },
  ): Promise<void> {}
}

export class MockCommandFinished extends MockCommand {
  public exitCode: number;

  constructor(opts: MockCommandOptions & { exitCode?: number } = {}) {
    const exitCode = opts.exitCode ?? 0;
    super({ ...opts, exitCode });
    this.exitCode = exitCode;
  }

  async wait(): Promise<MockCommandFinished> {
    return this;
  }
}
