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
  readonly cmdId: string;
  readonly cwd: string;
  readonly startedAt: number;
  exitCode: number | null;
  private _stdout: string;
  private _stderr: string;
  private _logs: LogLine[];

  constructor(opts: MockCommandOptions = {}) {
    this.cmdId = opts.cmdId ?? "cmd_" + Math.random().toString(36).slice(2);
    this.cwd = opts.cwd ?? "/";
    this.startedAt = opts.startedAt ?? Date.now();
    this.exitCode = opts.exitCode ?? null;
    this._stdout = opts.stdout ?? "";
    this._stderr = opts.stderr ?? "";
    this._logs = opts.logs ?? [];
  }

  logs(): AsyncGenerator<LogLine, void, void> & Disposable & { close(): void } {
    const items = this._logs;
    async function* gen() {
      for (const item of items) yield item;
    }
    return Object.assign(gen(), { [Symbol.dispose]() {}, close() {} });
  }

  async wait(): Promise<MockCommandFinished> {
    return new MockCommandFinished({
      cmdId: this.cmdId,
      cwd: this.cwd,
      startedAt: this.startedAt,
      exitCode: this.exitCode ?? 0,
      stdout: this._stdout,
      stderr: this._stderr,
      logs: this._logs,
    });
  }

  async output(stream: "stdout" | "stderr" | "both" = "both"): Promise<string> {
    if (stream === "stdout") return this._stdout;
    if (stream === "stderr") return this._stderr;
    return this._stdout + this._stderr;
  }

  async stdout(): Promise<string> {
    return this._stdout;
  }
  async stderr(): Promise<string> {
    return this._stderr;
  }
  async kill(): Promise<void> {}
}

export class MockCommandFinished extends MockCommand {
  declare exitCode: number;

  constructor(opts: MockCommandOptions = {}) {
    super({ ...opts, exitCode: opts.exitCode ?? 0 });
  }

  override async wait(): Promise<MockCommandFinished> {
    return this;
  }
}
