import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { APIClient, type CommandData } from "./api-client/index.js";
import { APIError } from "./api-client/api-error.js";
import { getCredentials } from "./utils/get-credentials.js";
import { resolveSignal, type Signal } from "./utils/resolveSignal.js";
import { waitWithStdinPipe, type StdinPipe } from "./utils/pipe-stdin.js";

/**
 * Bytes sent per stdin request, keeping the base64 JSON body under the API's
 * 1 MB request limit.
 */
const STDIN_CHUNK_BYTES = 512 * 1024;

/**
 * Cached output from a command execution.
 */
export interface CommandOutput {
  stdout: string;
  stderr: string;
}

/**
 * Serialized representation of a Command for @workflow/serde.
 */
export interface SerializedCommand {
  sandboxId: string;
  cmd: CommandData;
  /** Cached output, included if output was fetched before serialization */
  output?: CommandOutput;
}

/**
 * Serialized representation of a CommandFinished for @workflow/serde.
 */
export interface SerializedCommandFinished extends SerializedCommand {
  exitCode: number;
  durationMs?: number;
}

/**
 * A command executed in a Sandbox.
 *
 * For detached commands, you can {@link wait} to get a {@link CommandFinished} instance
 * with the populated exit code. For non-detached commands, {@link Sandbox.runCommand}
 * automatically waits and returns a {@link CommandFinished} instance.
 *
 * You can iterate over command output with {@link logs}.
 *
 * @see {@link Sandbox.runCommand} to start a command.
 *
 * @hideconstructor
 */
export class Command {
  /**
   * Cached API client instance.
   * @internal
   */
  protected _client: APIClient | null = null;

  /**
   * Lazily resolve credentials and construct an API client.
   * @internal
   */
  protected async ensureClient(): Promise<APIClient> {
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
   * ID of the session this command is running in.
   */
  protected sessionId: string;

  /**
   * Data for the command execution.
   */
  protected cmd: CommandData;

  public exitCode: number | null;

  public durationMs?: number;

  protected outputCache: Promise<{
    stdout: string;
    stderr: string;
    both: string;
  }> | null = null;

  /**
   * Synchronously accessible resolved output, populated after output is fetched.
   * Used for serialization.
   * @internal
   */
  protected _resolvedOutput: CommandOutput | null = null;

  /**
   * Tail of pending stdin writes, so concurrent calls reach the process in
   * call order.
   */
  private stdinQueue: Promise<void> = Promise.resolve();

  /**
   * Set when a write failed after possibly delivering some bytes. Later
   * writes are rejected so they can't be appended to a partial message.
   */
  private stdinError: unknown = null;

  /**
   * Bytes the API has confirmed written to stdin, sent with each request so
   * the API can skip bytes it already has when a request is resent. Unknown
   * until the first stdin call, because a deserialized `Command` can't know
   * what an earlier instance wrote.
   */
  private stdinOffset: number | null = null;

  /**
   * Set once a response lacks `bytesWritten`, meaning the sandbox predates
   * stdin offsets and a request can't be safely resent.
   */
  private stdinOffsetsUnsupported = false;

  /**
   * Set when the command was started with a `Readable` for stdin.
   * @internal
   */
  stdinPipe: StdinPipe | null = null;

  /**
   * ID of the command execution.
   */
  get cmdId() {
    return this.cmd.id;
  }

  get cwd() {
    return this.cmd.cwd;
  }

  get startedAt() {
    return this.cmd.startedAt;
  }

  /**
   * @param params - Object containing the client, sandbox ID, and command data.
   * @param params.client - Optional API client. If not provided, will be lazily created using global credentials.
   * @param params.sessionId - The ID of the session where the command is running.
   * @param params.cmd - The command data.
   * @param params.output - Optional cached output to restore (used during deserialization).
   */
  constructor({
    client,
    sessionId,
    cmd,
    output,
  }: {
    client?: APIClient;
    sessionId: string;
    cmd: CommandData;
    output?: CommandOutput;
  }) {
    this._client = client ?? null;
    this.sessionId = sessionId;
    this.cmd = cmd;
    this.exitCode = cmd.exitCode ?? null;
    this.durationMs = cmd.durationMs;
    if (output) {
      this._resolvedOutput = output;
      // Note: `both` is reconstructed as stdout + stderr concatenation,
      // which loses the original interleaved order of the streams.
      this.outputCache = Promise.resolve({
        stdout: output.stdout,
        stderr: output.stderr,
        both: output.stdout + output.stderr,
      });
    }
  }

  /**
   * Serialize a Command instance to plain data for @workflow/serde.
   *
   * @param instance - The Command instance to serialize
   * @returns A plain object containing the sandbox ID, command data, and output if fetched
   */
  static [WORKFLOW_SERIALIZE](instance: Command): SerializedCommand {
    const serialized: SerializedCommand = {
      sandboxId: instance.sessionId,
      cmd: instance.cmd,
    };
    if (instance._resolvedOutput) {
      serialized.output = instance._resolvedOutput;
    }
    return serialized;
  }

  /**
   * Deserialize plain data back into a Command instance for @workflow/serde.
   *
   * The deserialized instance will lazily create an API client using
   * OIDC or environment credentials when needed.
   *
   * @param data - The serialized command data
   * @returns The reconstructed Command instance
   */
  static [WORKFLOW_DESERIALIZE](data: SerializedCommand): Command {
    return new Command({
      sessionId: data.sandboxId,
      cmd: data.cmd,
      output: data.output,
    });
  }

  /**
   * Iterate over the output of this command.
   *
   * ```
   * for await (const log of cmd.logs()) {
   *   if (log.stream === "stdout") {
   *     process.stdout.write(log.data);
   *   } else {
   *     process.stderr.write(log.data);
   *   }
   * }
   * ```
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel log streaming.
   * @returns An async iterable of log entries from the command output.
   *
   * @see {@link Command.stdout}, {@link Command.stderr}, and {@link Command.output}
   * to access output as a string.
   */
  logs(opts?: { signal?: AbortSignal }) {
    if (!this._client) {
      throw new Error(
        "logs() requires an API client. Call an async method first to initialize the client.",
      );
    }
    return this._client.getLogs({
      sessionId: this.sessionId,
      cmdId: this.cmd.id,
      signal: opts?.signal,
    });
  }

  /**
   * Wait for a command to exit and populate its exit code.
   *
   * This method is useful for detached commands where you need to wait
   * for completion. For non-detached commands, {@link Sandbox.runCommand}
   * automatically waits and returns a {@link CommandFinished} instance.
   *
   * ```
   * const detachedCmd = await sandbox.runCommand({ cmd: 'sleep', args: ['5'], detached: true });
   * const result = await detachedCmd.wait();
   * if (result.exitCode !== 0) {
   *   console.error("Something went wrong...")
   * }
   * ```
   *
   * @param params - Optional parameters.
   * @param params.signal - An AbortSignal to cancel waiting.
   * @returns A {@link CommandFinished} instance with populated exit code.
   */
  async wait(params?: { signal?: AbortSignal }) {
    "use step";
    const client = await this.ensureClient();
    params?.signal?.throwIfAborted();

    const command = await waitWithStdinPipe(
      client.getCommand({
        sessionId: this.sessionId,
        cmdId: this.cmd.id,
        wait: true,
        signal: params?.signal,
      }),
      this.stdinPipe,
    );

    return new CommandFinished({
      client,
      sessionId: this.sessionId,
      cmd: command.json.command,
      exitCode: command.json.command.exitCode,
      durationMs: command.json.command.durationMs,
    });
  }

  /**
   * Get cached output, fetching logs only once and reusing for concurrent calls.
   * This prevents race conditions when stdout() and stderr() are called in parallel.
   */
  protected async getCachedOutput(opts?: { signal?: AbortSignal }): Promise<{
    stdout: string;
    stderr: string;
    both: string;
  }> {
    if (!this.outputCache) {
      this.outputCache = (async () => {
        try {
          opts?.signal?.throwIfAborted();
          // Ensure the API client is initialized before calling logs(),
          // since logs() is synchronous and requires _client to be set.
          await this.ensureClient();
          let stdout = "";
          let stderr = "";
          let both = "";
          for await (const log of this.logs({ signal: opts?.signal })) {
            both += log.data;
            if (log.stream === "stdout") {
              stdout += log.data;
            } else {
              stderr += log.data;
            }
          }
          // Store resolved output for serialization
          this._resolvedOutput = { stdout, stderr };
          return { stdout, stderr, both };
        } catch (err) {
          // Clear the promise so future calls can retry
          this.outputCache = null;
          throw err;
        }
      })();
    }

    return this.outputCache;
  }

  /**
   * Get the output of `stdout`, `stderr`, or both as a string.
   *
   * NOTE: This may throw string conversion errors if the command does
   * not output valid Unicode.
   *
   * @param stream - The output stream to read: "stdout", "stderr", or "both".
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel output streaming.
   * @returns The output of the specified stream(s) as a string.
   */
  async output(
    stream: "stdout" | "stderr" | "both" = "both",
    opts?: { signal?: AbortSignal },
  ) {
    "use step";
    const cached = await this.getCachedOutput(opts);
    return cached[stream];
  }

  /**
   * Get the output of `stdout` as a string.
   *
   * NOTE: This may throw string conversion errors if the command does
   * not output valid Unicode.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel output streaming.
   * @returns The standard output of the command.
   */
  async stdout(opts?: { signal?: AbortSignal }) {
    "use step";
    return this.output("stdout", opts);
  }

  /**
   * Get the output of `stderr` as a string.
   *
   * NOTE: This may throw string conversion errors if the command does
   * not output valid Unicode.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel output streaming.
   * @returns The standard error output of the command.
   */
  async stderr(opts?: { signal?: AbortSignal }) {
    "use step";
    return this.output("stderr", opts);
  }

  /**
   * Kill a running command in a sandbox.
   *
   * @param signal - The signal to send the running process. Defaults to SIGTERM.
   * @param opts - Optional parameters.
   * @param opts.abortSignal - An AbortSignal to cancel the kill operation.
   * @returns Promise<void>.
   */
  async kill(signal?: Signal, opts?: { abortSignal?: AbortSignal }) {
    "use step";
    const client = await this.ensureClient();
    await client.killCommand({
      sessionId: this.sessionId,
      commandId: this.cmd.id,
      signal: resolveSignal(signal ?? "SIGTERM"),
      abortSignal: opts?.abortSignal,
    });
  }

  /**
   * Write data to the stdin of a running command. The command must have been
   * started with `stdin: true` and `detached: true`.
   *
   * Writes are delivered in the order they are called. Resolves once the
   * process has accepted the data, so writing to a process that is not
   * reading from stdin waits until it does (up to a server-side timeout).
   *
   * Each request carries the stdin position it starts at, so a request that
   * fails because of a dropped connection or a restarting server is resent
   * without writing the same bytes twice. Don't write to the same command from
   * more than one place: the position is tracked per command, and concurrent
   * writers would have their bytes skipped as already written.
   *
   * If a write still fails after retries, part of the data may be written.
   * Further writes are then rejected; close stdin or kill the command instead.
   * In a workflow, each step gets a fresh `Command`, so ordering and this
   * rejection only apply within a step: await each write before starting the
   * next one, and stop writing after a failure.
   *
   * ```
   * const cmd = await sandbox.runCommand({ cmd: "cat", stdin: true, detached: true });
   * await cmd.writeStdin("hello\n");
   * await cmd.closeStdin();
   * ```
   *
   * @param data - The data to write. Strings are encoded as UTF-8.
   * @param opts - Optional parameters.
   * @param opts.abortSignal - An AbortSignal to cancel the write. Aborting a
   * write that has started may leave part of the data written.
   * @returns Promise<void>.
   */
  async writeStdin(
    data: string | Uint8Array,
    opts?: { abortSignal?: AbortSignal },
  ) {
    "use step";
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (bytes.length === 0) return;
    await this.enqueueStdin(async (client) => {
      if (this.stdinError) {
        throw new Error(
          "Stdin is in an unknown state after an earlier write failed. Close stdin or kill the command.",
          { cause: this.stdinError },
        );
      }
      await this.resolveStdinOffset(client, opts?.abortSignal);
      let sentChunks = 0;
      try {
        for (let i = 0; i < bytes.length; i += STDIN_CHUNK_BYTES) {
          const data = bytes.subarray(i, i + STDIN_CHUNK_BYTES);
          const { bytesWritten } = await client.writeCommandStdin({
            sessionId: this.sessionId,
            commandId: this.cmd.id,
            data,
            offset: this.requestOffset(),
            abortSignal: opts?.abortSignal,
          });
          this.confirmStdin(bytesWritten, data.length);
          sentChunks++;
        }
      } catch (err) {
        if (sentChunks > 0 || !isRejectedBeforeWrite(err)) {
          this.stdinError = err;
        }
        throw err;
      }
    }, opts?.abortSignal);
  }

  /**
   * Close the stdin of a running command, so it reads EOF once it has
   * consumed any pending data.
   *
   * @param opts - Optional parameters.
   * @param opts.abortSignal - An AbortSignal to cancel the operation.
   * @returns Promise<void>.
   */
  async closeStdin(opts?: { abortSignal?: AbortSignal }) {
    "use step";
    await this.enqueueStdin(async (client) => {
      await this.resolveStdinOffset(client, opts?.abortSignal);
      await client.writeCommandStdin({
        sessionId: this.sessionId,
        commandId: this.cmd.id,
        offset: this.requestOffset(),
        close: true,
        abortSignal: opts?.abortSignal,
      });
    }, opts?.abortSignal);
  }

  private async resolveStdinOffset(client: APIClient, abortSignal?: AbortSignal) {
    if (this.stdinOffset !== null) return;
    const { bytesWritten } = await client.writeCommandStdin({
      sessionId: this.sessionId,
      commandId: this.cmd.id,
      abortSignal,
    });
    this.stdinOffsetsUnsupported = bytesWritten === undefined;
    this.stdinOffset = bytesWritten ?? 0;
  }

  private requestOffset() {
    return this.stdinOffsetsUnsupported ? undefined : (this.stdinOffset ?? 0);
  }

  private confirmStdin(bytesWritten: number | undefined, length: number) {
    if (bytesWritten === undefined) {
      this.stdinOffsetsUnsupported = true;
      this.stdinOffset = (this.stdinOffset ?? 0) + length;
    } else {
      this.stdinOffset = bytesWritten;
    }
  }

  private enqueueStdin(
    fn: (client: APIClient) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    const previous = this.stdinQueue;
    const run = (async () => {
      await waitForTurn(previous, signal);
      return fn(await this.ensureClient());
    })();
    this.stdinQueue = Promise.allSettled([previous, run]).then(() => {});
    return run;
  }
}

(Command.prototype.writeStdin as { maxRetries?: number }).maxRetries = 0;
(Command.prototype.closeStdin as { maxRetries?: number }).maxRetries = 0;

/**
 * Whether a stdin write failed in a way that guarantees none of it reached
 * the process: the API rejected it with a client error before applying it.
 */
function isRejectedBeforeWrite(err: unknown) {
  return (
    err instanceof APIError &&
    err.response.status >= 400 &&
    err.response.status < 500
  );
}

function waitForTurn(previous: Promise<void>, signal?: AbortSignal) {
  if (!signal) return previous;
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    previous.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

/**
 * A command that has finished executing.
 *
 * The exit code is immediately available and populated upon creation.
 * Unlike {@link Command}, you don't need to call wait() - the command
 * has already completed execution.
 *
 * @hideconstructor
 */
export class CommandFinished extends Command {
  /**
   * The exit code of the command. This is always populated for
   * CommandFinished instances.
   */
  public exitCode: number;

  /**
   * The duration of the command execution in milliseconds.
   */
  public durationMs?: number;

  /**
   * @param params - Object containing client, sandbox ID, command data, and exit code.
   * @param params.client - Optional API client. If not provided, will be lazily created using global credentials.
   * @param params.sessionId - The ID of the session where the command ran.
   * @param params.cmd - The command data.
   * @param params.exitCode - The exit code of the completed command.
   * @param params.durationMs - Optional duration of the command execution in milliseconds.
   * @param params.output - Optional cached output to restore (used during deserialization).
   */
  constructor(params: {
    client?: APIClient;
    sessionId: string;
    cmd: CommandData;
    exitCode: number;
    durationMs?: number;
    output?: CommandOutput;
  }) {
    super({ ...params });
    this.exitCode = params.exitCode;
    this.durationMs = params.durationMs ?? params.cmd.durationMs;
  }

  /**
   * Serialize a CommandFinished instance to plain data for @workflow/serde.
   *
   * @param instance - The CommandFinished instance to serialize
   * @returns A plain object containing the sandbox ID, command data, exit code, and output if fetched
   */
  static [WORKFLOW_SERIALIZE](
    instance: CommandFinished,
  ): SerializedCommandFinished {
    return {
      ...Command[WORKFLOW_SERIALIZE](instance),
      exitCode: instance.exitCode,
      durationMs: instance.durationMs,
    };
  }

  /**
   * Deserialize plain data back into a CommandFinished instance for @workflow/serde.
   *
   * The deserialized instance will lazily create an API client using
   * OIDC or environment credentials when needed.
   *
   * @param data - The serialized command finished data
   * @returns The reconstructed CommandFinished instance
   */
  static [WORKFLOW_DESERIALIZE](
    data: SerializedCommandFinished,
  ): CommandFinished {
    return new CommandFinished({
      sessionId: data.sandboxId,
      cmd: data.cmd,
      exitCode: data.exitCode,
      durationMs: data.durationMs,
      output: data.output,
    });
  }

  /**
   * The wait method is not needed for CommandFinished instances since
   * the command has already completed and exitCode is populated.
   *
   * @deprecated This method is redundant for CommandFinished instances.
   * The exitCode is already available.
   * @returns This CommandFinished instance.
   */
  async wait(): Promise<CommandFinished> {
    return this;
  }

  /**
   * Not available: the command has already exited.
   *
   * @deprecated Always throws on a finished command.
   * @throws Always.
   */
  async writeStdin(
    _data: string | Uint8Array,
    _opts?: { abortSignal?: AbortSignal },
  ): Promise<never> {
    throw new Error("Cannot write to stdin: the command has already finished.");
  }

  /**
   * Not available: the command has already exited.
   *
   * @deprecated Always throws on a finished command.
   * @throws Always.
   */
  async closeStdin(_opts?: { abortSignal?: AbortSignal }): Promise<never> {
    throw new Error("Cannot close stdin: the command has already finished.");
  }
}
