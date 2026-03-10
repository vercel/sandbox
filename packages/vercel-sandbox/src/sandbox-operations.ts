import { createWriteStream } from "fs";
import { mkdir as mkdirLocal } from "fs/promises";
import { dirname, resolve } from "path";
import { type Writable } from "stream";
import { pipeline } from "stream/promises";
import { APIClient } from "./api-client";
import { type WithFetchOptions } from "./api-client/api-client";
import { Command, CommandFinished } from "./command";
import { type NetworkPolicy } from "./network-policy";
import { Snapshot } from "./snapshot";
import { consumeReadable } from "./utils/consume-readable";
import { convertSandbox, type ConvertedSandbox } from "./utils/convert-sandbox";
import { type Credentials, getCredentials } from "./utils/get-credentials";

export interface RunCommandParams {
  /**
   * The command to execute.
   */
  cmd: string;
  /**
   * Arguments to pass to the command.
   */
  args?: string[];
  /**
   * Working directory to execute the command in.
   */
  cwd?: string;
  /**
   * Environment variables to set for this command.
   */
  env?: Record<string, string>;
  /**
   * If true, execute this command with root privileges. Defaults to false.
   */
  sudo?: boolean;
  /**
   * If true, the command will return without waiting for `exitCode`.
   */
  detached?: boolean;
  /**
   * A `Writable` stream where `stdout` from the command will be piped.
   */
  stdout?: Writable;
  /**
   * A `Writable` stream where `stderr` from the command will be piped.
   */
  stderr?: Writable;
  /**
   * An AbortSignal to cancel the command execution.
   */
  signal?: AbortSignal;
}

export interface SandboxAccessOptions extends WithFetchOptions {
  client?: APIClient;
  token?: string;
  teamId?: string;
  projectId?: string;
}

interface SandboxClientOptions {
  client?: APIClient;
}

interface SandboxSignalOptions extends SandboxClientOptions {
  signal?: AbortSignal;
}

interface DownloadFileOptions extends SandboxSignalOptions {
  mkdirRecursive?: boolean;
}

interface StopSandboxOptions extends SandboxSignalOptions {
  blocking?: boolean;
}

interface CreateSnapshotOptions extends SandboxSignalOptions {
  expiration?: number;
}

function getSandboxAccessCredentials(
  params?: SandboxAccessOptions,
): Pick<Credentials, "teamId" | "token"> | null {
  if (params?.client) {
    return null;
  }

  if (
    typeof params?.token === "string" &&
    typeof params?.teamId === "string"
  ) {
    return {
      token: params.token,
      teamId: params.teamId,
    };
  }

  if (params?.token !== undefined || params?.teamId !== undefined) {
    const missing = [
      typeof params?.token === "string" ? null : "token",
      typeof params?.teamId === "string" ? null : "teamId",
    ].filter((value) => value !== null);

    throw new Error(
      `Missing credentials parameters to access the Vercel API: ${missing.join(", ")}`,
    );
  }

  return null;
}

export async function createSandboxClient(
  params?: SandboxAccessOptions,
): Promise<APIClient> {
  if (params?.client) {
    return params.client;
  }

  const credentials =
    getSandboxAccessCredentials(params) ?? (await getCredentials(params));

  return new APIClient({
    teamId: credentials.teamId,
    token: credentials.token,
    fetch: params?.fetch,
  });
}

async function getSandboxDetails(
  sandboxId: string,
  opts?: SandboxSignalOptions,
) {
  const client = await createSandboxClient(opts);
  const response = await client.getSandbox({
    sandboxId,
    signal: opts?.signal,
  });

  return {
    client,
    sandbox: response.json.sandbox,
    routes: response.json.routes,
  };
}

async function runSandboxCommand(
  client: APIClient,
  sandboxId: string,
  params: RunCommandParams,
) {
  const wait = params.detached ? false : true;
  const streamLogs = (command: Command) => {
    if (params.stdout || params.stderr) {
      (async () => {
        try {
          for await (const log of command.logs({ signal: params.signal })) {
            if (log.stream === "stdout") {
              params.stdout?.write(log.data);
            } else if (log.stream === "stderr") {
              params.stderr?.write(log.data);
            }
          }
        } catch (err) {
          if (params.signal?.aborted) {
            return;
          }
          throw err;
        }
      })();
    }
  };

  if (wait) {
    const commandStream = await client.runCommand({
      sandboxId,
      command: params.cmd,
      args: params.args ?? [],
      cwd: params.cwd,
      env: params.env ?? {},
      sudo: params.sudo ?? false,
      wait: true,
      signal: params.signal,
    });

    const command = new Command({
      client,
      sandboxId,
      cmd: commandStream.command,
    });

    streamLogs(command);

    const finished = await commandStream.finished;
    return new CommandFinished({
      client,
      sandboxId,
      cmd: finished,
      exitCode: finished.exitCode ?? 0,
    });
  }

  const commandResponse = await client.runCommand({
    sandboxId,
    command: params.cmd,
    args: params.args ?? [],
    cwd: params.cwd,
    env: params.env ?? {},
    sudo: params.sudo ?? false,
    signal: params.signal,
  });

  const command = new Command({
    client,
    sandboxId,
    cmd: commandResponse.json.command,
  });

  streamLogs(command);

  return command;
}

/**
 * Retrieve a previously run command from an existing sandbox by ID.
 */
export async function getCommand(
  sandboxId: string,
  cmdId: string,
  opts?: SandboxSignalOptions,
): Promise<Command> {
  const client = await createSandboxClient(opts);
  const response = await client.getCommand({
    sandboxId,
    cmdId,
    signal: opts?.signal,
  });

  return new Command({
    client,
    sandboxId,
    cmd: response.json.command,
  });
}

/**
 * Start executing a command in an existing sandbox by ID.
 */
export async function runCommand(
  sandboxId: string,
  command: string,
  args?: string[],
  opts?: SandboxSignalOptions,
): Promise<CommandFinished>;
export async function runCommand(
  sandboxId: string,
  params: RunCommandParams & { detached: true },
  opts?: SandboxClientOptions,
): Promise<Command>;
export async function runCommand(
  sandboxId: string,
  params: RunCommandParams,
  opts?: SandboxClientOptions,
): Promise<CommandFinished>;
export async function runCommand(
  sandboxId: string,
  commandOrParams: string | RunCommandParams,
  argsOrOptions?: string[] | SandboxSignalOptions,
  maybeOptions?: SandboxSignalOptions,
): Promise<Command | CommandFinished> {
  if (typeof commandOrParams === "string") {
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : undefined;
    const options =
      Array.isArray(argsOrOptions) || argsOrOptions === undefined
        ? maybeOptions
        : argsOrOptions;
    const client = await createSandboxClient(options);

    return runSandboxCommand(client, sandboxId, {
      cmd: commandOrParams,
      args,
      signal: options?.signal,
    });
  }

  const options = !Array.isArray(argsOrOptions) ? argsOrOptions : maybeOptions;
  const client = await createSandboxClient(options);
  return runSandboxCommand(client, sandboxId, commandOrParams);
}

/**
 * Create a directory in an existing sandbox by ID.
 */
export async function mkDir(
  sandboxId: string,
  path: string,
  opts?: SandboxSignalOptions,
): Promise<void> {
  const client = await createSandboxClient(opts);
  await client.mkDir({
    sandboxId,
    path,
    signal: opts?.signal,
  });
}

/**
 * Alias for {@link mkDir}.
 */
export async function mkdir(
  sandboxId: string,
  path: string,
  opts?: SandboxSignalOptions,
): Promise<void> {
  await mkDir(sandboxId, path, opts);
}

/**
 * Read a file from an existing sandbox by ID as a stream.
 */
export async function readFile(
  sandboxId: string,
  file: { path: string; cwd?: string },
  opts?: SandboxSignalOptions,
): Promise<NodeJS.ReadableStream | null> {
  const client = await createSandboxClient(opts);
  return client.readFile({
    sandboxId,
    path: file.path,
    cwd: file.cwd,
    signal: opts?.signal,
  });
}

/**
 * Read a file from an existing sandbox by ID as a buffer.
 */
export async function readFileToBuffer(
  sandboxId: string,
  file: { path: string; cwd?: string },
  opts?: SandboxSignalOptions,
): Promise<Buffer | null> {
  const stream = await readFile(sandboxId, file, opts);

  if (stream === null) {
    return null;
  }

  return consumeReadable(stream);
}

/**
 * Download a file from an existing sandbox by ID to the local filesystem.
 */
export async function downloadFile(
  sandboxId: string,
  src: { path: string; cwd?: string },
  dst: { path: string; cwd?: string },
  opts?: DownloadFileOptions,
): Promise<string | null> {
  if (!src?.path) {
    throw new Error("downloadFile: source path is required");
  }

  if (!dst?.path) {
    throw new Error("downloadFile: destination path is required");
  }

  const stream = await readFile(sandboxId, src, opts);

  if (stream === null) {
    return null;
  }

  try {
    const dstPath = resolve(dst.cwd ?? "", dst.path);
    if (opts?.mkdirRecursive) {
      await mkdirLocal(dirname(dstPath), { recursive: true });
    }
    await pipeline(stream, createWriteStream(dstPath), {
      signal: opts?.signal,
    });
    return dstPath;
  } finally {
    if ("destroy" in stream && typeof stream.destroy === "function") {
      stream.destroy();
    }
  }
}

/**
 * Write multiple files to an existing sandbox by ID.
 */
export async function writeFiles(
  sandboxId: string,
  files: { path: string; content: Buffer }[],
  opts?: SandboxSignalOptions,
): Promise<void> {
  const { client, sandbox } = await getSandboxDetails(sandboxId, opts);

  await client.writeFiles({
    sandboxId,
    cwd: sandbox.cwd,
    extractDir: "/",
    files,
    signal: opts?.signal,
  });
}

/**
 * Write a single file to an existing sandbox by ID.
 */
export async function writeFile(
  sandboxId: string,
  file: { path: string; content: Buffer },
  opts?: SandboxSignalOptions,
): Promise<void> {
  await writeFiles(sandboxId, [file], opts);
}

/**
 * Resolve the public domain for a port exposed by an existing sandbox.
 */
export async function getSandboxDomain(
  sandboxId: string,
  port: number,
  opts?: SandboxSignalOptions,
): Promise<string> {
  const { routes } = await getSandboxDetails(sandboxId, opts);
  const route = routes.find((candidate) => candidate.port === port);

  if (!route) {
    throw new Error(`No route for port ${port}`);
  }

  return `https://${route.subdomain}.vercel.run`;
}

/**
 * Stop an existing sandbox by ID.
 */
export async function stopSandbox(
  sandboxId: string,
  opts?: StopSandboxOptions,
): Promise<ConvertedSandbox> {
  const client = await createSandboxClient(opts);
  const response = await client.stopSandbox({
    sandboxId,
    signal: opts?.signal,
    blocking: opts?.blocking,
  });

  return convertSandbox(response.json.sandbox);
}

/**
 * Update the network policy for an existing sandbox by ID.
 */
export async function updateSandboxNetworkPolicy(
  sandboxId: string,
  networkPolicy: NetworkPolicy,
  opts?: SandboxSignalOptions,
): Promise<NetworkPolicy> {
  const client = await createSandboxClient(opts);
  const response = await client.updateNetworkPolicy({
    sandboxId,
    networkPolicy,
    signal: opts?.signal,
  });

  return convertSandbox(response.json.sandbox).networkPolicy!;
}

/**
 * Extend the timeout of an existing sandbox by ID.
 */
export async function extendSandboxTimeout(
  sandboxId: string,
  duration: number,
  opts?: SandboxSignalOptions,
): Promise<void> {
  const client = await createSandboxClient(opts);
  await client.extendTimeout({
    sandboxId,
    duration,
    signal: opts?.signal,
  });
}

/**
 * Create a snapshot from an existing sandbox by ID.
 */
export async function createSnapshot(
  sandboxId: string,
  opts?: CreateSnapshotOptions,
): Promise<Snapshot> {
  const client = await createSandboxClient(opts);
  const response = await client.createSnapshot({
    sandboxId,
    expiration: opts?.expiration,
    signal: opts?.signal,
  });

  return new Snapshot({
    client,
    snapshot: response.json.snapshot,
  });
}
