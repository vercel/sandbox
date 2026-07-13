import type {
  SandboxCommand as JustBashCommand,
  SandboxCommandFinished as JustBashCommandFinished,
} from "just-bash";

export class Command {
  readonly #inner: JustBashCommand;

  /**
   * Duration of the command execution in milliseconds. Populated once the
   * command has finished; `undefined` while a detached command is still
   * running.
   */
  public durationMs?: number;

  constructor(inner: JustBashCommand) {
    this.#inner = inner;
    this.durationMs =
      inner.exitCode !== undefined
        ? Math.max(0, Date.now() - inner.startedAt.getTime())
        : undefined;
  }

  get cmdId(): string {
    return this.#inner.cmdId;
  }

  get cwd(): string {
    return this.#inner.cwd;
  }

  get startedAt(): number {
    return this.#inner.startedAt.getTime();
  }

  get exitCode(): number | null {
    return this.#inner.exitCode ?? null;
  }

  logs(_opts?: {
    signal?: AbortSignal;
  }): AsyncGenerator<
    { data: string; stream: "stdout" } | { data: string; stream: "stderr" },
    void,
    void
  > &
    Disposable & { close(): void } {
    const inner = this.#inner;
    async function* gen() {
      for await (const msg of inner.logs()) {
        yield { data: msg.data, stream: msg.type };
      }
    }
    const generator = gen();
    const result = Object.assign(generator, {
      [Symbol.dispose]() {
        void generator.return(undefined);
      },
      close() {
        void generator.return(undefined);
      },
    });
    return result;
  }

  async wait(_params?: { signal?: AbortSignal }): Promise<CommandFinished> {
    const finished = await this.#inner.wait();
    return new CommandFinished(finished);
  }

  async output(
    stream?: "stdout" | "stderr" | "both",
    _opts?: { signal?: AbortSignal },
  ): Promise<string> {
    if (stream === "stdout") return this.#inner.stdout();
    if (stream === "stderr") return this.#inner.stderr();
    return this.#inner.output();
  }

  async stdout(_opts?: { signal?: AbortSignal }): Promise<string> {
    return this.#inner.stdout();
  }

  async stderr(_opts?: { signal?: AbortSignal }): Promise<string> {
    return this.#inner.stderr();
  }

  async kill(_signal?: string | number, _opts?: { abortSignal?: AbortSignal }): Promise<void> {
    return this.#inner.kill();
  }
}

export class CommandFinished extends Command {
  #exitCodeValue: number;

  constructor(inner: JustBashCommandFinished) {
    super(inner);
    this.#exitCodeValue = inner.exitCode;
  }

  override get exitCode(): number {
    return this.#exitCodeValue;
  }

  override async wait(): Promise<CommandFinished> {
    return this;
  }
}

export function createCommand(inner: JustBashCommand): Command {
  return new Command(inner);
}

export function createCommandFinished(inner: JustBashCommandFinished): CommandFinished {
  return new CommandFinished(inner);
}
