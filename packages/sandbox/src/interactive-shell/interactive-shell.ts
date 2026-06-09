import { Sandbox } from "@vercel/sandbox";
import createDebugger from "debug";
import { WebSocket } from "ws";
import { printCommand } from "../util/print-command";
import ora from "ora";
import { acquireRelease, createAbortController, defer } from "../util/disposables";
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
 */
const PS1 = `▲ \\[\\e[2m\\]\\w/\\[\\e[0m\\] `;

/**
 * Starts an interactive shell session with a sandbox. The API hands us a
 * WebSocket URL and token, and we tunnel stdin/stdout over it.
 */
export async function startInteractiveShell(options: {
  sandbox: Sandbox;
  cwd?: string;
  execution: [string, ...string[]];
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

  const [command, ...args] = options.execution;
  const execution: [string, ...string[]] = options.sudo
    ? ["sudo", command, ...args]
    : [command, ...args];

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
      command: execution[0],
      args: execution.slice(1),
      env: toEnvArray({ TERM, PS1, ...options.envVars }),
      // Default to the sandbox's working directory (e.g. `/vercel/sandbox`).
      // The PTY server runs as a system process at `/`, so without this the
      // shell would inherit `/` instead of the sandbox home it used to start in.
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

  console.error(printCommand(options.execution[0], options.execution.slice(1)));

  await new Promise<void>((resolve, reject) => {
    client.once("close", () => resolve());
    client.once("error", (err) => reject(err));
  });

  extension.abort("client disconnected");
  process.removeListener("SIGWINCH", onResize);
  process.stdin.removeListener("data", onStdin);

  console.error(chalk.dim(`\n╰▶ connection to ▲ ${options.sandbox.name} closed.`));
}

function toEnvArray(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}
