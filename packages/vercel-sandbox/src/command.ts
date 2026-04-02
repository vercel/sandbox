import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { APIClient, type CommandData } from "./api-client/index.js";
import { getCredentials } from "./utils/get-credentials.js";
import { resolveSignal, type Signal } from "./utils/resolveSignal.js";

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
   * ID of the sandbox this command is running in.
   */
  protected sandboxId: string;

  /**
   * Data for the command execution.
   */
  protected cmd: CommandData;

  public exitCode: number | null;

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
   * @param params.sandboxId - The ID of the sandbox where the command is running.
   * @param params.cmd - The command data.
   * @param params.output - Optional cached output to restore (used during deserialization).
   */
  constructor({
    client,
    sandboxId,
    cmd,
    output,
  }: {
    client?: APIClient;
    sandboxId: string;
    cmd: CommandData;
    output?: CommandOutput;
  }) {
    this._client = client ?? null;
    this.sandboxId = sandboxId;
    this.cmd = cmd;
    this.exitCode = cmd.exitCode ?? null;
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
      sandboxId: instance.sandboxId,
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
      sandboxId: data.sandboxId,
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
      sandboxId: this.sandboxId,
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

    const command = await client.getCommand({
      sandboxId: this.sandboxId,
      cmdId: this.cmd.id,
      wait: true,
      signal: params?.signal,
    });

    return new CommandFinished({
      client,
      sandboxId: this.sandboxId,
      cmd: command.json.command,
      exitCode: command.json.command.exitCode,
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
      sandboxId: this.sandboxId,
      commandId: this.cmd.id,
      signal: resolveSignal(signal ?? "SIGTERM"),
      abortSignal: opts?.abortSignal,
    });
  }
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
   * @param params - Object containing client, sandbox ID, command data, and exit code.
   * @param params.client - Optional API client. If not provided, will be lazily created using global credentials.
   * @param params.sandboxId - The ID of the sandbox where the command ran.
   * @param params.cmd - The command data.
   * @param params.exitCode - The exit code of the completed command.
   * @param params.output - Optional cached output to restore (used during deserialization).
   */
  constructor(params: {
    client?: APIClient;
    sandboxId: string;
    cmd: CommandData;
    exitCode: number;
    output?: CommandOutput;
  }) {
    super({ ...params });
    this.exitCode = params.exitCode;
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
      sandboxId: data.sandboxId,
      cmd: data.cmd,
      exitCode: data.exitCode,
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
}
