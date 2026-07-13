import { Sandbox as JustBashSandbox } from "just-bash";
import type { Command as CustomCommand, IFileSystem } from "just-bash";
import { buildUserCommands } from "./user-commands.js";
import { tryFsCommand } from "./fs-commands.js";
import type { UserState } from "./registry.js";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  startedAt: number;
  durationMs: number;
}

export interface RunArgs {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
}

/**
 * `sudo` is not a real binary in just-bash. The SDK invokes it as a literal
 * command — either `sudo -u <user> -- <cmd> <args...>` (run-as-user) or, when
 * `SandboxUser` passes `sudo: true`, as the raw command with a body flag.
 * Strip the `sudo`/options prefix and run the inner argv; there is no real
 * privilege or identity change (just-bash always runs as root).
 */
function unwrapSudo(command: string, args: string[]): { command: string; args: string[] } {
  if (command !== "sudo") return { command, args };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") {
      i++;
      break;
    }
    if (arg === "-u" || arg === "-g" || arg === "-U") {
      i += 2; // option with a value
      continue;
    }
    if (arg.startsWith("-")) {
      i++;
      continue;
    }
    break;
  }
  const inner = args.slice(i);
  if (inner.length === 0) return { command: "sudo", args };
  return { command: inner[0], args: inner.slice(1) };
}

/**
 * Runs commands for a single session against an in-memory just-bash sandbox.
 * Exposes the virtual filesystem (`fs`) for the `fs/*` endpoints and snapshot
 * capture/restore.
 */
export class Executor {
  #inner: JustBashSandbox;
  #cwd: string;

  private constructor(inner: JustBashSandbox, cwd: string) {
    this.#inner = inner;
    this.#cwd = cwd;
  }

  static async create(config: {
    cwd: string;
    env?: Record<string, string>;
    users: UserState;
    customCommands: CustomCommand[];
  }): Promise<Executor> {
    const inner = await JustBashSandbox.create({
      cwd: config.cwd,
      env: config.env,
      customCommands: [...buildUserCommands(config.users), ...config.customCommands],
    });
    return new Executor(inner, config.cwd);
  }

  get fs(): IFileSystem {
    return this.#inner.bashEnvInstance.fs;
  }

  async run(params: RunArgs): Promise<RunResult> {
    const { command, args } = unwrapSudo(params.command, params.args);
    const startedAt = Date.now();

    // Intercept the coreutils invocations the SDK's FileSystem makes with
    // GNU flags just-bash doesn't support; everything else runs in just-bash.
    const intercepted = await tryFsCommand(this.fs, params.cwd ?? this.#cwd, command, args);
    if (intercepted) {
      return { ...intercepted, startedAt, durationMs: Math.max(0, Date.now() - startedAt) };
    }

    const result = await this.#inner.runCommand({
      cmd: command,
      args,
      cwd: params.cwd,
      env: params.env,
    });
    return {
      stdout: await result.stdout(),
      stderr: await result.stderr(),
      exitCode: result.exitCode,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  async stop(): Promise<void> {
    await this.#inner.stop();
  }
}
