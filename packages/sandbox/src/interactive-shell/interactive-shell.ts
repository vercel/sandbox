import { Sandbox } from "@vercel/sandbox";
import createDebugger from "debug";
import { WebSocket } from "ws";
import { printCommand } from "../util/print-command";
import ora from "ora";
import {
  acquireRelease,
  createAbortController,
  defer,
} from "../util/disposables";
import chalk from "chalk";
import { extendSandboxTimeoutPeriodically } from "./extend-sandbox-timeout";

const debug = createDebugger("sandbox:interactive-shell");

/**
 * A default TERM value so applications like `vim` and `nano` work properly.
 */
const TERM = "xterm-256color";

/**
 * A custom prompt so interactive sessions show the Vercel triangle and the
 * working directory (e.g. `▲ /vercel/sandbox/ `) instead of the shell's
 * default prompt. The server passes this through to the shell verbatim.
 *
 * This is built from primitives every POSIX shell honors so it renders the
 * same regardless of which shell a customer image ships as `/bin/sh`.
 *
 * The color escapes are wrapped in the raw readline "ignore" markers
 * `\x01` (RL_PROMPT_START_IGNORE) and `\x02` (RL_PROMPT_END_IGNORE) — the
 * same bytes that bash's `\[` / `\]` decode into. This lets bash's readline
 * exclude the (zero-width) escape sequences from its prompt-width calculation
 * so cursor positioning stays correct on long/wrapping lines and during line
 * editing. In non-bash shells these are C0 control bytes that terminals treat
 * as non-printing, so they don't affect rendering there.
 */
const PS1 = `▲ \x01\x1b[2m\x02$PWD/\x01\x1b[0m\x02 `;

/**
 * The flag that turns a shell into a login shell, so it sources the account's
 * profile (`~/.profile`, `~/.bash_profile`, ...) the way a real login does.
 * Spelled out in full because that is the form bash, zsh, fish and `sudo` all
 * accept. Shells that only take `-l` would have to be special-cased where the
 * shell is actually known, which is the sandbox, not here.
 */
const LOGIN = "--login";

/**
 * What the interactive server should spawn, as it goes over the wire.
 */
export interface InteractiveExecution {
  /**
   * The executable to spawn. The empty string asks the sandbox to spawn the
   * shell the account declares in the passwd database.
   */
  command: string;
  args: string[];
}

/**
 * Resolves the process an interactive session starts.
 *
 * With no explicit command the session should open a shell, but which shell
 * that is belongs to the sandbox: an image can give its user zsh, or install
 * the usual one somewhere else, and the client has no business guessing a path
 * that happens to exist in every image. Sending an empty command asks the
 * sandbox to resolve the account's shell from its passwd entry, and `--login`
 * makes it a login shell so the account's profile is sourced.
 *
 * `sudo --login` (`sudo -i`) is the same contract for the target account: sudo
 * spawns the shell root's passwd entry declares, as a login shell. Because
 * that starts in root's home directory, `--workdir` does not survive the
 * combination of `--sudo` and an implicit shell.
 *
 * An explicit command is passed through untouched.
 */
export function resolveExecution(options: {
  execution?: [string, ...string[]];
  sudo: boolean;
}): InteractiveExecution {
  const { execution, sudo } = options;

  if (!execution) {
    return sudo
      ? { command: "sudo", args: [LOGIN] }
      : { command: "", args: [LOGIN] };
  }

  const [command, ...args] = execution;
  return sudo
    ? { command: "sudo", args: [command, ...args] }
    : { command, args };
}

/**
 * Starts an interactive shell session with a sandbox. The API hands us a
 * WebSocket URL and token, and we tunnel stdin/stdout over it.
 *
 * Omitting `execution` opens the account's configured shell as a login shell.
 */
export async function startInteractiveShell(options: {
  sandbox: Sandbox;
  cwd?: string;
  execution?: [string, ...string[]];
  envVars: Record<string, string>;
  sudo: boolean;
  skipExtendingTimeout: boolean;
}) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }

    process.stdin.removeAllListeners();
    try {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.unref();
    } catch {
      // Ignore errors restoring stdin.
    }
    cleaned = true;
  };
  process.once("beforeExit", cleanup);
  using _cleanup = defer(cleanup);

  using progress = acquireRelease(
    () => ora({ discardStdin: false }).start(),
    (s) => s.stop(),
  );

  progress.text = "Opening interactive session...";
  const { url, token } = await options.sandbox.openInteractive();

  const execution = resolveExecution(options);

  progress.text = "Connecting...";
  const client = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
  using _client = defer(() => {
    try {
      client.close();
    } catch {
      // Ignore errors closing the socket.
    }
  });

  await new Promise<void>((resolve, reject) => {
    client.once("open", () => resolve());
    client.once("error", (err) => reject(err));
  });
  debug("connected to %s", url);

  client.send(
    JSON.stringify({
      type: "start",
      command: execution.command,
      args: execution.args,
      env: toEnvArray({ TERM, PS1, ...options.envVars }),
      cwd: options.cwd ?? options.sandbox.cwd,
      cols: process.stdout.columns,
      rows: process.stdout.rows,
    }),
  );

  progress.stop();

  using extension = createAbortController("stopped extensions");
  if (!options.skipExtendingTimeout) {
    extendSandboxTimeoutPeriodically(options.sandbox, extension.signal).catch(
      extension.ignoreInterruptions,
    );
  }

  // server -> stdout (binary frames) and exit (text control frame).
  client.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      process.stdout.write(data);
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "exit") {
        process.exitCode = typeof msg.code === "number" ? msg.code : undefined;
      }
    } catch {
      // Non-JSON text frame; treat as output.
      process.stdout.write(data);
    }
  });

  // stdin -> server (binary frames).
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  const onStdin = (chunk: Buffer) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(chunk);
    }
  };
  process.stdin.on("data", onStdin);

  const onResize = () => {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(
      JSON.stringify({
        type: "resize",
        cols: process.stdout.columns,
        rows: process.stdout.rows,
      }),
    );
  };
  process.on("SIGWINCH", onResize);

  // Nothing to echo for an implicit shell: the sandbox picks the executable,
  // so printing a guess here would name a process that never ran.
  if (execution.command) {
    console.error(printCommand(execution.command, execution.args));
  }

  await new Promise<void>((resolve, reject) => {
    client.once("close", () => resolve());
    client.once("error", (err) => reject(err));
  });

  extension.abort("client disconnected");
  process.removeListener("SIGWINCH", onResize);
  process.stdin.removeListener("data", onStdin);

  console.error(
    chalk.dim(`\n╰▶ connection to ▲ ${options.sandbox.name} closed.`),
  );
}

function toEnvArray(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}
