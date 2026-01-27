import { Command, Sandbox } from "@vercel/sandbox";
import {
  captureStdin,
  createListener,
  type Listener,
} from "@vercel/pty-tunnel";
import createDebugger from "debug";
import { printCommand } from "../util/print-command";
import ora, { Ora } from "ora";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  acquireRelease,
  createAbortController,
  defer,
} from "../util/disposables";
import { createWriteStream } from "node:fs";
import chalk from "chalk";
import assert from "node:assert";
import { extendSandboxTimeoutPeriodically } from "./extend-sandbox-timeout";

const debug = createDebugger("sandbox:interactive-shell");
const debugPty = createDebugger("sandbox:interactive-shell:pty");

/**
 * A default TERM value to use if none is set in the environment.
 * That way, applications like `vim` and `nano` will work properly.
 */
const TERM = "xterm-256color";

const neverResolvedPromise = new Promise<void>(() => {});

/**
 * Prepares the sandbox environment for interactive shell by installing required dependencies
 * and copying the TTY server script.
 *
 * @param sandbox - The sandbox instance to prepare
 * @returns Promise that resolves when environment is ready
 */
async function setupSandboxEnvironment(
  sandbox: Sandbox,
  ora: Ora,
): Promise<void> {
  using installed = createAbortController(`Finished installation`);

  const waitUntilInstalled = checkIfServerInstalled(
    sandbox,
    installed.signal,
  ).then(
    (installed) => (installed ? void 0 : neverResolvedPromise),
    (err) => {
      debug("Error checking if server is installed:", err);
    },
  );

  await Promise.race([
    installServerBinary(sandbox, ora, installed.signal),
    waitUntilInstalled.then(() => debug("Server binary already installed")),
  ]).catch(installed.ignoreInterruptions);
}

async function checkIfServerInstalled(sandbox: Sandbox, signal: AbortSignal) {
  const exists = await sandbox.runCommand({
    cmd: "command",
    args: ["-v", SERVER_BIN_NAME],
    signal,
  });
  return exists.exitCode === 0;
}

async function installServerBinary(
  sandbox: Sandbox,
  ora: Ora,
  signal: AbortSignal,
) {
  let firstSent = false;
  const createPassthrough = () => {
    const passthrough = new PassThrough();
    passthrough.on("data", (chunk) => {
      if (!firstSent) {
        firstSent = true;
        ora.text += `\n`;
      }
      ora.text += chunk.toString();
    });
    return passthrough;
  };

  const pathname = `/tmp/vc-pty-tunnel-server-${randomUUID()}`;

  // Upload the x86_64 binary to the sandbox
  const currentPath = import.meta.url;
  await sandbox.writeFiles(
    [
      {
        path: pathname,
        content: await fs.readFile(
          process.env.VERCEL_DEV !== "0"
            ? new URL("../../dist/pty-server-linux-x86_64", currentPath)
            : new URL("./pty-server-linux-x86_64", currentPath),
        ),
      },
    ],
    { signal },
  );

  // Move the binary to /usr/local/bin and make it executable
  await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      `mv "${pathname}" /usr/local/bin/${SERVER_BIN_NAME}; chmod +x /usr/local/bin/${SERVER_BIN_NAME}`,
    ],
    sudo: true,
    signal,
    stdout: createPassthrough(),
    stderr: createPassthrough(),
  });
}

const SERVER_BIN_NAME = "vc-interactive-server";
const INTERACTIVE_BIN_OUTPUT = process.env.VERCEL_CLI_INTERACTIVE_BIN_OUTPUT;

/**
 * Starts the TTY server command inside the sandbox with proper WebRTC configuration.
 */
async function startServerCommand(
  sandbox: Sandbox,
  _listener: Listener,
  execution: [string, ...string[]],
  sudo: boolean,
  env: Record<string, string>,
  cwd?: string,
): Promise<Command> {
  return sandbox.runCommand({
    cmd: SERVER_BIN_NAME,
    args: [
      `--port=${sandbox.interactivePort}`,
      `--mode=client`,
      ...(debugPty.enabled ? [`--debug`] : []),
      `--cols=${process.stdout.columns}`,
      `--rows=${process.stdout.rows}`,
      ...execution,
    ],
    sudo,
    cwd,
    env: {
      TERM,
      PS1: `▲ \\[\\e[2m\\]\\w/\\[\\e[0m\\] `,
      ...env,
    },
    detached: true,
  });
}

/**
 * Starts an interactive shell session with a sandbox using WebRTC for real-time communication.
 *
 * @param options - Configuration including sandbox, command to execute, and sudo flag
 * @returns Object with wait promise and cleanup function
 */
export async function startInteractiveShell(options: {
  sandbox: Sandbox;
  cwd?: string;
  execution: [string, ...string[]];
  envVars: Record<string, string>;
  sudo: boolean;
  skipExtendingTimeout: boolean;
}) {
  const listener = createListener();

  let command: Command | null = null;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    process.stdin.removeAllListeners();
    listener.stdoutStream.end();
    try {
      process.stdin.destroy();
    } catch {
      // Ignore errors during stdin destruction
    }
    process.stdin.setRawMode(false);
    command?.kill().catch(() => {});
    cleaned = true;
  };

  process.once("beforeExit", cleanup);
  using _cleanup = defer(cleanup);

  using progress = acquireRelease(
    () => ora({ discardStdin: false }).start(),
    (s) => s.clear(),
  );

  progress.text = "Setting up sandbox environment";
  await setupSandboxEnvironment(options.sandbox, progress);

  progress.text = "Booting up interactive listener...";
  command = await startServerCommand(
    options.sandbox,
    listener,
    options.execution,
    options.sudo,
    options.envVars,
    options.cwd,
  );

  using waitForProcess = createAbortController(
    "Connection established successfully",
  );
  listener.connection.then(() => {
    waitForProcess.abort();
  });
  connect(command, listener, waitForProcess.signal).catch(
    waitForProcess.ignoreInterruptions,
  );

  await Promise.all([
    throwIfCommandPrematurelyExited(command, waitForProcess.signal),
    attach({
      sandbox: options.sandbox,
      progress,
      listener,
      skipExtendingTimeout: options.skipExtendingTimeout,
      printCommand: () =>
        console.error(
          printCommand(
            options.sandbox.sandboxId,
            options.execution[0],
            options.execution.slice(1),
          ),
        ),
    }),
  ]).catch(waitForProcess.ignoreInterruptions);
}

async function throwIfCommandPrematurelyExited(
  command: Command,
  signal: AbortSignal,
) {
  try {
    const { exitCode } = await command.wait({ signal });
    throw new Error(
      [
        `Interactive shell failed to start (exit code: ${exitCode}).`,
        `${chalk.bold("hint:")} The sandbox may have timed out or encountered an error.`,
        "╰▶ Check sandbox status with `sandbox list` or view logs for details.",
      ].join("\n"),
    );
  } catch (err) {
    if (signal.aborted) {
      return;
    }
    throw err;
  }
}

async function attach({
  progress,
  listener,
  printCommand,
  sandbox,
  skipExtendingTimeout,
}: {
  sandbox: Sandbox;
  progress: Ora;
  listener: Listener;
  printCommand: () => void;
  skipExtendingTimeout: boolean;
}) {
  progress.text = "Waiting for connection...";
  const details = await listener.connection;

  assert(sandbox.interactivePort, "Sandbox interactive port is not defined");
  const url =
    `wss://${sandbox.domain(sandbox.interactivePort).replace(/^https?:\/\//, "")}` as const;
  debug("Connecting to WebSocket URL:", url);

  const stdoutPipe = messageReader(process.stdout);
  const client = details.createClient(url);
  client.addEventListener("message", async ({ data }) => {
    stdoutPipe.next(data);
  });

  await client.waitForOpen();
  progress.stop();

  using extensionController = createAbortController("stopped extensions");
  if (!skipExtendingTimeout) {
    extendSandboxTimeoutPeriodically(sandbox, extensionController.signal).catch(
      extensionController.ignoreInterruptions,
    );
  }

  client.sendMessage({ type: "ready" });
  client.sendMessage({
    type: "resize",
    cols: process.stdout.columns,
    rows: process.stdout.rows,
  });

  process.on("SIGWINCH", () => {
    client.sendMessage({
      type: "resize",
      cols: process.stdout.columns,
      rows: process.stdout.rows,
    });
  });
  process.stdin.removeAllListeners();
  captureStdin({ redirectTo: client });

  printCommand();

  await new Promise((resolve, reject) => {
    client.addEventListener("close", (a) => resolve(a), { once: true });
    client.addEventListener("error", (err) => reject(err), { once: true });
  });

  extensionController.abort("client disconnected");
  client.close();

  console.error(
    chalk.dim(`\n╰▶ connection to ▲ ${sandbox.sandboxId} closed.`),
  );
}

/**
 * Async generator to allow easy coordination of parsing the events from the {@link Listener}
 *
 * @example
 * const pipe = messageReader(process.stdout);
 * pipe.next(new Blob(["Hello, World!"]));
 */
async function* messageReader(
  stream: typeof process.stdout,
): AsyncGenerator<
  void,
  never,
  Blob | ArrayBuffer | Buffer | string | Buffer[]
> {
  while (true) {
    const value = yield;
    if (!value) continue;

    let output: string | Buffer;
    if (typeof value === "string" || Buffer.isBuffer(value)) {
      output = value;
    } else if (
      typeof value === "object" &&
      "arrayBuffer" in value &&
      typeof value.arrayBuffer === "function"
    ) {
      output = Buffer.from(await value.arrayBuffer());
    } else if (value instanceof Blob) {
      output = Buffer.from(await value.arrayBuffer());
    } else if (Array.isArray(value)) {
      output = Buffer.concat(value);
    } else {
      output = Buffer.from(value);
    }
    stream.write(output);
  }
}

/**
 * Connects the command's logs to the listener's stdout and stderr streams.
 */
async function connect(
  command: Command,
  listener: Listener,
  signal: AbortSignal,
) {
  using logs = command.logs({ signal });
  using stderrStream = getStderrStream();
  for await (const chunk of logs) {
    if (chunk.stream === "stdout") {
      listener.stdoutStream.write(chunk.data);
    } else {
      stderrStream.write(chunk.data);
    }
  }
}

function getStderrStream() {
  return acquireRelease(
    () => {
      if (INTERACTIVE_BIN_OUTPUT) {
        const writeStream = createWriteStream(INTERACTIVE_BIN_OUTPUT);
        return {
          write(chunk: any) {
            writeStream.write(chunk);
          },
          close() {
            writeStream.close();
          },
        };
      }
      if (debugPty.enabled) {
        return {
          write(chunk: any) {
            process.stderr.write(chunk);
          },
        };
      }
      return { write() {} };
    },
    (s) => {
      s.close?.();
    },
  );
}
