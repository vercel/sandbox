import {
  BaseClient,
  parseOrThrow,
  type Parsed,
  type RequestParams,
} from "./base-client";
import {
CommandFinishedData,
  SandboxAndRoutesResponse,
  SandboxResponse,
  CommandResponse,
  CommandFinishedResponse,
  EmptyResponse,
  LogLine,
  LogLineStdout,
  LogLineStderr,
  SandboxesResponse,
  SnapshotsResponse,
  ExtendTimeoutResponse,
  UpdateNetworkPolicyResponse,
  SnapshotResponse,
  CreateSnapshotResponse,
  type CommandData,
} from "./validators";
import { APIError, StreamError } from "./api-error";
import { FileWriter } from "./file-writer";
import { VERSION } from "../version";
import { consumeReadable } from "../utils/consume-readable";
import { z } from "zod";
import jsonlines from "jsonlines";
import os from "os";
import { Readable } from "stream";
import { normalizePath } from "../utils/normalizePath";
import { JwtExpiry } from "../utils/jwt-expiry";
import { NetworkPolicy } from "../network-policy";
import { toAPINetworkPolicy, fromAPINetworkPolicy } from "../utils/network-policy";
import { getPrivateParams, WithPrivate } from "../utils/types";
import { RUNTIMES } from "../constants";

export interface WithFetchOptions {
  fetch?: typeof globalThis.fetch;
}

export class APIClient extends BaseClient {
  private teamId: string;
  private tokenExpiry: JwtExpiry | null;

  constructor(params: {
    baseUrl?: string;
    teamId: string;
    token: string;
    fetch?: typeof globalThis.fetch;
  }) {
    super({
      baseUrl: params.baseUrl ?? "https://vercel.com/api",
      token: params.token,
      debug: false,
      fetch: params.fetch,
    });

    this.teamId = params.teamId;
    this.tokenExpiry = JwtExpiry.fromToken(params.token);
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.tokenExpiry) {
      return;
    }

    const newExpiry = await this.tokenExpiry.tryRefresh();
    if (!newExpiry) {
      return;
    }

    this.tokenExpiry = newExpiry;
    this.token = this.tokenExpiry.token;
    if (this.tokenExpiry.payload) {
      this.teamId = this.tokenExpiry.payload?.owner_id;
    }
  }

  protected async request(path: string, params?: RequestParams) {
    await this.ensureValidToken();

    return super.request(path, {
      ...params,
      query: { teamId: this.teamId, ...params?.query },
      headers: {
        "content-type": "application/json",
        "user-agent": `vercel/sandbox/${VERSION} (Node.js/${process.version}; ${os.platform()}/${os.arch()})`,
        ...params?.headers,
      },
    });
  }

  async getSandbox(
    params: WithPrivate<{ sandboxId: string; signal?: AbortSignal }>,
  ) {
    const privateParams = getPrivateParams(params);
    let querystring = new URLSearchParams(privateParams).toString();
    querystring = querystring ? `?${querystring}` : "";
    return parseOrThrow(
      SandboxAndRoutesResponse,
      await this.request(`/v1/sandboxes/${params.sandboxId}${querystring}`, {
        signal: params.signal,
      }),
    );
  }

  async createSandbox(
    params: WithPrivate<{
      ports?: number[];
      projectId: string;
      source?:
        | {
            type: "git";
            url: string;
            depth?: number;
            revision?: string;
            username?: string;
            password?: string;
          }
        | { type: "tarball"; url: string }
        | { type: "snapshot"; snapshotId: string };
      timeout?: number;
      resources?: { vcpus: number };
      runtime?: RUNTIMES | (string & {});
      networkPolicy?: NetworkPolicy;
      signal?: AbortSignal;
    }>,
  ) {
    const privateParams = getPrivateParams(params);
    return parseOrThrow(
      SandboxAndRoutesResponse,
      await this.request("/v1/sandboxes", {
        method: "POST",
        body: JSON.stringify({
          projectId: params.projectId,
          ports: params.ports,
          source: params.source,
          timeout: params.timeout,
          resources: params.resources,
          runtime: params.runtime,
          networkPolicy: params.networkPolicy
            ? toAPINetworkPolicy(params.networkPolicy)
            : undefined,
          ...privateParams,
        }),
        signal: params.signal,
      }),
    );
  }

  async runCommand(params: {
    sandboxId: string;
    cwd?: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    sudo: boolean;
    wait: true;
    signal?: AbortSignal;
  }): Promise<{ command: CommandData; finished: Promise<CommandFinishedData> }>;
  async runCommand(params: {
    sandboxId: string;
    cwd?: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    sudo: boolean;
    wait?: false;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof CommandResponse>>>;
  async runCommand(params: {
    sandboxId: string;
    cwd?: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    sudo: boolean;
    wait?: boolean;
    signal?: AbortSignal;
  }) {
    if (params.wait) {
      const response = await this.request(
        `/v1/sandboxes/${params.sandboxId}/cmd`,
        {
          method: "POST",
          body: JSON.stringify({
            command: params.command,
            args: params.args,
            cwd: params.cwd,
            env: params.env,
            sudo: params.sudo,
            wait: true,
          }),
          signal: params.signal,
        },
      );

      if (!response.ok) {
        await parseOrThrow(z.any(), response);
      }

      if (response.headers.get("content-type") !== "application/x-ndjson") {
        throw new APIError(response, {
          message: "Expected a stream of command data",
          sandboxId: params.sandboxId,
        });
      }

      if (response.body === null) {
        throw new APIError(response, {
          message: "No response body",
          sandboxId: params.sandboxId,
        });
      }

      const jsonlinesStream = jsonlines.parse();
      pipe(response.body, jsonlinesStream).catch((err) => {
        console.error("Error piping command stream:", err);
      });

      const iterator = jsonlinesStream[Symbol.asyncIterator]();
      const commandChunk = await iterator.next();
      const { command } = CommandResponse.parse(commandChunk.value);

      const finished = (async () => {
        const finishedChunk = await iterator.next();  
        const { command } = CommandFinishedResponse.parse(finishedChunk.value);
        return command;
      })();

      return { command, finished };
    }

    return parseOrThrow(
      CommandResponse,
      await this.request(`/v1/sandboxes/${params.sandboxId}/cmd`, {
        method: "POST",
        body: JSON.stringify({
          command: params.command,
          args: params.args,
          cwd: params.cwd,
          env: params.env,
          sudo: params.sudo,
        }),
        signal: params.signal,
      }),
    );
  }

  async getCommand(params: {
    sandboxId: string;
    cmdId: string;
    wait: true;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof CommandFinishedResponse>>>;
  async getCommand(params: {
    sandboxId: string;
    cmdId: string;
    wait?: boolean;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof CommandResponse>>>;
  async getCommand(params: {
    sandboxId: string;
    cmdId: string;
    wait?: boolean;
    signal?: AbortSignal;
  }) {
    return params.wait
      ? parseOrThrow(
          CommandFinishedResponse,
          await this.request(
            `/v1/sandboxes/${params.sandboxId}/cmd/${params.cmdId}`,
            { signal: params.signal, query: { wait: "true" } },
          ),
        )
      : parseOrThrow(
          CommandResponse,
          await this.request(
            `/v1/sandboxes/${params.sandboxId}/cmd/${params.cmdId}`,
            { signal: params.signal },
          ),
        );
  }

  async mkDir(params: {
    sandboxId: string;
    path: string;
    cwd?: string;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      EmptyResponse,
      await this.request(`/v1/sandboxes/${params.sandboxId}/fs/mkdir`, {
        method: "POST",
        body: JSON.stringify({ path: params.path, cwd: params.cwd }),
        signal: params.signal,
      }),
    );
  }

  getFileWriter(params: {
    sandboxId: string;
    extractDir: string;
    signal?: AbortSignal;
  }) {
    const writer = new FileWriter();
    return {
      response: (async () => {
        return this.request(`/v1/sandboxes/${params.sandboxId}/fs/write`, {
          method: "POST",
          headers: {
            "content-type": "application/gzip",
            "x-cwd": params.extractDir,
          },
          body: await consumeReadable(writer.readable),
          signal: params.signal,
        });
      })(),
      writer,
    };
  }

  async listSandboxes(params: {
    /**
     * The ID or name of the project to which the sandboxes belong.
     * @example "my-project"
     */
    projectId: string;
    /**
     * Maximum number of sandboxes to list from a request.
     * @example 10
     */
    limit?: number;
    /**
     * Get sandboxes created after this JavaScript timestamp.
     * @example 1540095775941
     */
    since?: number | Date;
    /**
     * Get sandboxes created before this JavaScript timestamp.
     * @example 1540095775951
     */
    until?: number | Date;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      SandboxesResponse,
      await this.request(`/v1/sandboxes`, {
        query: {
          project: params.projectId,
          limit: params.limit,
          since:
            typeof params.since === "number"
              ? params.since
              : params.since?.getTime(),
          until:
            typeof params.until === "number"
              ? params.until
              : params.until?.getTime(),
        },
        method: "GET",
        signal: params.signal,
      }),
    );
  }

  async listSnapshots(params: {
    /**
     * The ID or name of the project to which the snapshots belong.
     * @example "my-project"
     */
    projectId: string;
    /**
     * Maximum number of snapshots to list from a request.
     * @example 10
     */
    limit?: number;
    /**
     * Get snapshots created after this JavaScript timestamp.
     * @example 1540095775941
     */
    since?: number | Date;
    /**
     * Get snapshots created before this JavaScript timestamp.
     * @example 1540095775951
     */
    until?: number | Date;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      SnapshotsResponse,
      await this.request(`/v1/sandboxes/snapshots`, {
        query: {
          project: params.projectId,
          limit: params.limit,
          since:
            typeof params.since === "number"
              ? params.since
              : params.since?.getTime(),
          until:
            typeof params.until === "number"
              ? params.until
              : params.until?.getTime(),
        },
        method: "GET",
        signal: params.signal,
      }),
    );
  }

  async writeFiles(params: {
    sandboxId: string;
    cwd: string;
    files: { path: string; content: Buffer }[];
    extractDir: string;
    signal?: AbortSignal;
  }) {
    const { writer, response } = this.getFileWriter({
      sandboxId: params.sandboxId,
      extractDir: params.extractDir,
      signal: params.signal,
    });

    for (const file of params.files) {
      await writer.addFile({
        name: normalizePath({
          filePath: file.path,
          extractDir: params.extractDir,
          cwd: params.cwd,
        }),
        content: file.content,
      });
    }

    writer.end();
    await parseOrThrow(EmptyResponse, await response);
  }

  async readFile(params: {
    sandboxId: string;
    path: string;
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<Readable | null> {
    const response = await this.request(
      `/v1/sandboxes/${params.sandboxId}/fs/read`,
      {
        method: "POST",
        body: JSON.stringify({ path: params.path, cwd: params.cwd }),
        signal: params.signal,
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (response.body === null) {
      return null;
    }

    return Readable.fromWeb(response.body);
  }

  async killCommand(params: {
    sandboxId: string;
    commandId: string;
    signal: number;
    abortSignal?: AbortSignal;
  }) {
    return parseOrThrow(
      CommandResponse,
      await this.request(
        `/v1/sandboxes/${params.sandboxId}/${params.commandId}/kill`,
        {
          method: "POST",
          body: JSON.stringify({ signal: params.signal }),
          signal: params.abortSignal,
        },
      ),
    );
  }

  getLogs(params: {
    sandboxId: string;
    cmdId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<
    z.infer<typeof LogLineStdout> | z.infer<typeof LogLineStderr>,
    void,
    void
  > &
    Disposable & { close(): void } {
    const self = this;
    const disposer = new AbortController();
    const signal = !params.signal
      ? disposer.signal
      : mergeSignals(params.signal, disposer.signal);

    const generator = (async function* () {
      const url = `/v1/sandboxes/${params.sandboxId}/cmd/${params.cmdId}/logs`;
      const response = await self.request(url, {
        method: "GET",
        signal,
      });

      if (!response.ok) {
        await parseOrThrow(z.any(), response);
      }

      if (response.headers.get("content-type") !== "application/x-ndjson") {
        throw new APIError(response, {
          message: "Expected a stream of logs",
          sandboxId: params.sandboxId,
        });
      }

      if (response.body === null) {
        throw new APIError(response, {
          message: "No response body",
          sandboxId: params.sandboxId,
        });
      }

      const jsonlinesStream = jsonlines.parse();
      pipe(response.body, jsonlinesStream).catch((err) => {
        console.error("Error piping logs:", err);
      });

      for await (const chunk of jsonlinesStream) {
        const parsed = LogLine.parse(chunk);
        if (parsed.stream === "error") {
          throw new StreamError(
            parsed.data.code,
            parsed.data.message,
            params.sandboxId,
          );
        }
        yield parsed;
      }
    })();

    return Object.assign(generator, {
      [Symbol.dispose]() {
        disposer.abort("Disposed");
      },
      close: () => disposer.abort("Disposed"),
    });
  }

  async stopSandbox(params: {
    sandboxId: string;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof SandboxResponse>>> {
    const url = `/v1/sandboxes/${params.sandboxId}/stop`;
    return parseOrThrow(
      SandboxResponse,
      await this.request(url, { method: "POST", signal: params.signal }),
    );
  }

  async updateNetworkPolicy(params: {
    sandboxId: string;
    networkPolicy: NetworkPolicy;
    signal?: AbortSignal;
  }): Promise<NetworkPolicy> {
    const url = `/v1/sandboxes/${params.sandboxId}/network-policy`;
    const response = await parseOrThrow(
      UpdateNetworkPolicyResponse,
      await this.request(url, {
        method: "POST",
        body: JSON.stringify(toAPINetworkPolicy(params.networkPolicy)),
        signal: params.signal,
      }),
    );
    return fromAPINetworkPolicy(response.json.sandbox.networkPolicy!);
  }

  async extendTimeout(params: {
    sandboxId: string;
    duration: number;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof ExtendTimeoutResponse>>> {
    const url = `/v1/sandboxes/${params.sandboxId}/extend-timeout`;
    return parseOrThrow(
      ExtendTimeoutResponse,
      await this.request(url, {
        method: "POST",
        body: JSON.stringify({ duration: params.duration }),
        signal: params.signal,
      }),
    );
  }

  async createSnapshot(params: {
    sandboxId: string;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof CreateSnapshotResponse>>> {
    const url = `/v1/sandboxes/${params.sandboxId}/snapshot`;
    return parseOrThrow(
      CreateSnapshotResponse,
      await this.request(url, { method: "POST", signal: params.signal }),
    );
  }

  async deleteSnapshot(params: {
    snapshotId: string;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof SnapshotResponse>>> {
    const url = `/v1/sandboxes/snapshots/${params.snapshotId}`;
    return parseOrThrow(
      SnapshotResponse,
      await this.request(url, { method: "DELETE", signal: params.signal }),
    );
  }

  async getSnapshot(params: {
    snapshotId: string;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof SnapshotResponse>>> {
    const url = `/v1/sandboxes/snapshots/${params.snapshotId}`;
    return parseOrThrow(
      SnapshotResponse,
      await this.request(url, { signal: params.signal }),
    );
  }
}

async function pipe(
  readable: ReadableStream<Uint8Array>,
  output: NodeJS.WritableStream,
) {
  const reader = readable.getReader();
  try {
    while (true) {
      const read = await reader.read();
      if (read.value) {
        output.write(Buffer.from(read.value));
      }
      if (read.done) {
        break;
      }
    }
  } catch (err) {
    output.emit("error", err);
  } finally {
    output.end();
  }
}

function mergeSignals(...signals: [AbortSignal, ...AbortSignal[]]) {
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
    for (const signal of signals) {
      signal.removeEventListener("abort", onAbort);
    }
  };
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", onAbort);
  }
  return controller.signal;
}
