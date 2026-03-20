import {
  BaseClient,
  parseOrThrow,
  type Parsed,
  type RequestParams,
} from "./base-client.js";
import {
type CommandFinishedData,
  SessionAndRoutesResponse,
  SessionResponse,
  SessionsResponse,
  CommandResponse,
  CommandFinishedResponse,
  EmptyResponse,
  LogLine,
  type LogLineStdout,
  type LogLineStderr,
  SnapshotsResponse,
  SnapshotResponse,
  CreateSnapshotResponse,
  SandboxAndSessionResponse,
  SandboxesPaginationResponse,
  UpdateSandboxResponse,
  type CommandData,
} from "./validators.js";
import { APIError, StreamError } from "./api-error.js";
import { FileWriter } from "./file-writer.js";
import { VERSION } from "../version.js";
import { consumeReadable } from "../utils/consume-readable.js";
import { z } from "zod";
import jsonlines from "jsonlines";
import os from "os";
import { Readable } from "stream";
import { normalizePath } from "../utils/normalizePath.js";
import { getVercelOidcToken } from "@vercel/oidc";
import { NetworkPolicy } from "../network-policy.js";
import { toAPINetworkPolicy, fromAPINetworkPolicy } from "../utils/network-policy.js";
import { getPrivateParams, WithPrivate } from "../utils/types.js";
import { RUNTIMES } from "../constants.js";
import { setTimeout } from "node:timers/promises";

interface Claims {
  owner_id: string;
  project_id?: string;
}

function decodeUnverifiedToken(token: string): Claims | null {
  if (token.split(".").length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    if (payload.owner_id) {
      return { owner_id: payload.owner_id, project_id: payload.project_id };
    }
    return null;
  } catch {
    return null;
  }
}

export interface WithFetchOptions {
  fetch?: typeof globalThis.fetch;
}

export class APIClient extends BaseClient {
  private teamId: string;
  private projectId: string | undefined;
  private isJwtToken: boolean;

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
    this.isJwtToken = false;

    const claims = decodeUnverifiedToken(params.token);
    if (claims) {
      this.isJwtToken = true;
      this.projectId = claims.project_id;
      this.teamId = claims.owner_id;
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.isJwtToken) {
      return;
    }

    try {
      // Use getVercelOidcToken to refresh the token with team/project scope
      const freshToken = await getVercelOidcToken({
        expirationBufferMs: 5 * 60 * 1000, // 5 minutes
        team: this.teamId,
        project: this.projectId,
      });

      // Update token if it changed
      if (freshToken !== this.token) {
        this.token = freshToken;

        const claims = decodeUnverifiedToken(freshToken);
        if (claims) {
          this.teamId = claims.owner_id;
        }
      }
    } catch {
      // Ignore refresh errors and continue with current token
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

  async getSession(
    params: WithPrivate<{ sessionId: string; signal?: AbortSignal }>,
  ) {
    const privateParams = getPrivateParams(params);
    let querystring = new URLSearchParams(privateParams).toString();
    querystring = querystring ? `?${querystring}` : "";
    return parseOrThrow(
      SessionAndRoutesResponse,
      await this.request(`/v2/sandboxes/sessions/${params.sessionId}${querystring}`, {
        signal: params.signal,
      }),
    );
  }

  async createSandbox(
    params: WithPrivate<{
      name?: string;
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
      persistent?: boolean;
      runtime?: RUNTIMES | (string & {});
      networkPolicy?: NetworkPolicy;
      env?: Record<string, string>;
      tags?: Record<string, string>;
      snapshotExpiration?: number;
      signal?: AbortSignal;
    }>,
  ) {
    const privateParams = getPrivateParams(params);
    return parseOrThrow(
      SandboxAndSessionResponse,
      await this.request("/v2/sandboxes", {
        method: "POST",
        body: JSON.stringify({
          projectId: params.projectId,
          ports: params.ports,
          source: params.source,
          timeout: params.timeout,
          resources: params.resources,
          runtime: params.runtime,
          name: params.name,
          persistent: params.persistent,
          networkPolicy: params.networkPolicy
            ? toAPINetworkPolicy(params.networkPolicy)
            : undefined,
          env: params.env,
          tags: params.tags,
          snapshotExpiration: params.snapshotExpiration,
          ...privateParams,
        }),
        signal: params.signal,
      }),
    );
  }

  async runCommand(params: {
    sessionId: string;
    cwd?: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    sudo: boolean;
    wait: true;
    signal?: AbortSignal;
  }): Promise<{ command: CommandData; finished: Promise<CommandFinishedData> }>;
  async runCommand(params: {
    sessionId: string;
    cwd?: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    sudo: boolean;
    wait?: false;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof CommandResponse>>>;
  async runCommand(params: {
    sessionId: string;
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
        `/v2/sandboxes/sessions/${params.sessionId}/cmd`,
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
          sessionId: params.sessionId,
        });
      }

      if (response.body === null) {
        throw new APIError(response, {
          message: "No response body",
          sessionId: params.sessionId,
        });
      }

      const jsonlinesStream = jsonlines.parse();
      pipe(response.body, jsonlinesStream).catch((err) => {
        console.error("Error piping command stream:", err);
      });

      const iterator = jsonlinesStream[Symbol.asyncIterator]();
      const commandChunk = await iterator.next();
      const { command } = CommandResponse.parse(commandChunk.value);

      const finished = (async () => {
        const finishedChunk = await iterator.next();
        const { command } = CommandFinishedResponse.parse(finishedChunk.value);
        return command;
      })();

      return { command, finished };
    }

    return parseOrThrow(
      CommandResponse,
      await this.request(`/v2/sandboxes/sessions/${params.sessionId}/cmd`, {
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
    sessionId: string;
    cmdId: string;
    wait: true;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof CommandFinishedResponse>>>;
  async getCommand(params: {
    sessionId: string;
    cmdId: string;
    wait?: boolean;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof CommandResponse>>>;
  async getCommand(params: {
    sessionId: string;
    cmdId: string;
    wait?: boolean;
    signal?: AbortSignal;
  }) {
    return params.wait
      ? parseOrThrow(
          CommandFinishedResponse,
          await this.request(
            `/v2/sandboxes/sessions/${params.sessionId}/cmd/${params.cmdId}`,
            { signal: params.signal, query: { wait: "true" } },
          ),
        )
      : parseOrThrow(
          CommandResponse,
          await this.request(
            `/v2/sandboxes/sessions/${params.sessionId}/cmd/${params.cmdId}`,
            { signal: params.signal },
          ),
        );
  }

  async mkDir(params: {
    sessionId: string;
    path: string;
    cwd?: string;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      EmptyResponse,
      await this.request(`/v2/sandboxes/sessions/${params.sessionId}/fs/mkdir`, {
        method: "POST",
        body: JSON.stringify({ path: params.path, cwd: params.cwd }),
        signal: params.signal,
      }),
    );
  }

  getFileWriter(params: {
    sessionId: string;
    extractDir: string;
    signal?: AbortSignal;
  }) {
    const writer = new FileWriter();
    return {
      response: (async () => {
        return this.request(`/v2/sandboxes/sessions/${params.sessionId}/fs/write`, {
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

  async listSessions(params: {
    /**
     * The ID or name of the project to which the sessions belong.
     * @example "my-project"
     */
    projectId: string;
    /**
     * Filter sessions by sandbox name.
     */
    name?: string;
    /**
     * Maximum number of sessions to list from a request.
     * @example 10
     */
    limit?: number;
    /**
     * Cursor for pagination.
     */
    cursor?: string;
    /**
     * Sort order for results.
     */
    sortOrder?: "asc" | "desc";
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      SessionsResponse,
      await this.request(`/v2/sandboxes/sessions`, {
        query: {
          project: params.projectId,
          name: params.name,
          limit: params.limit,
          cursor: params.cursor,
          sortOrder: params.sortOrder,
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
     * Filter snapshots by sandbox name.
     */
    name?: string;
    /**
     * Maximum number of snapshots to list from a request.
     * @example 10
     */
    limit?: number;
    /**
     * Cursor for pagination.
     */
    cursor?: string;
    /**
     * Sort order for results.
     */
    sortOrder?: "asc" | "desc";
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      SnapshotsResponse,
      await this.request(`/v2/sandboxes/snapshots`, {
        query: {
          project: params.projectId,
          name: params.name,
          limit: params.limit,
          cursor: params.cursor,
          sortOrder: params.sortOrder,
        },
        method: "GET",
        signal: params.signal,
      }),
    );
  }

  async writeFiles(params: {
    sessionId: string;
    cwd: string;
    files: { path: string; content: Buffer; mode?: number }[];
    extractDir: string;
    signal?: AbortSignal;
  }) {
    const { writer, response } = this.getFileWriter({
      sessionId: params.sessionId,
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
        mode: file.mode,
      });
    }

    writer.end();
    await parseOrThrow(EmptyResponse, await response);
  }

  async readFile(params: {
    sessionId: string;
    path: string;
    cwd?: string;
    signal?: AbortSignal;
  }): Promise<Readable | null> {
    const response = await this.request(
      `/v2/sandboxes/sessions/${params.sessionId}/fs/read`,
      {
        method: "POST",
        body: JSON.stringify({ path: params.path, cwd: params.cwd }),
        signal: params.signal,
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      await parseOrThrow(z.any(), response);
    }

    if (response.body === null) {
      return null;
    }

    return Readable.fromWeb(response.body);
  }

  async killCommand(params: {
    sessionId: string;
    commandId: string;
    signal: number;
    abortSignal?: AbortSignal;
  }) {
    return parseOrThrow(
      CommandResponse,
      await this.request(
        `/v2/sandboxes/sessions/${params.sessionId}/cmd/${params.commandId}/kill`,
        {
          method: "POST",
          body: JSON.stringify({ signal: params.signal }),
          signal: params.abortSignal,
        },
      ),
    );
  }

  getLogs(params: {
    sessionId: string;
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
      const url = `/v2/sandboxes/sessions/${params.sessionId}/cmd/${params.cmdId}/logs`;
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
          sessionId: params.sessionId,
        });
      }

      if (response.body === null) {
        throw new APIError(response, {
          message: "No response body",
          sessionId: params.sessionId,
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
            params.sessionId,
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

  async stopSession(params: {
    sessionId: string;
    signal?: AbortSignal;
    blocking?: boolean;
  }): Promise<Parsed<z.infer<typeof SessionResponse>>> {
    const url = `/v2/sandboxes/sessions/${params.sessionId}/stop`;
    const response = await parseOrThrow(
      SessionResponse,
      await this.request(url, { method: "POST", signal: params.signal }),
    );

    if (params.blocking) {
      let session = response.json.session;
      while (session.status !== "stopped" && session.status !== "failed" && session.status !== "aborted") {
        await setTimeout(500, undefined, { signal: params.signal });
        const poll = await this.getSession({
          sessionId: params.sessionId,
          signal: params.signal,
        });
        session = poll.json.session;
        response.json.session = session;
      }
    }

    return response;
  }

  async updateNetworkPolicy(params: {
    sessionId: string;
    networkPolicy: NetworkPolicy;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof SessionResponse>>> {
    const url = `/v2/sandboxes/sessions/${params.sessionId}/network-policy`;
    return parseOrThrow(
      SessionResponse,
      await this.request(url, {
        method: "POST",
        body: JSON.stringify(toAPINetworkPolicy(params.networkPolicy)),
        signal: params.signal,
      }),
    );
  }

  async extendTimeout(params: {
    sessionId: string;
    duration: number;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof SessionResponse>>> {
    const url = `/v2/sandboxes/sessions/${params.sessionId}/extend-timeout`;
    return parseOrThrow(
      SessionResponse,
      await this.request(url, {
        method: "POST",
        body: JSON.stringify({ duration: params.duration }),
        signal: params.signal,
      }),
    );
  }

  async createSnapshot(params: {
    sessionId: string;
    expiration?: number;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof CreateSnapshotResponse>>> {
    const url = `/v2/sandboxes/sessions/${params.sessionId}/snapshot`;
    const body =
      params.expiration === undefined
        ? undefined
        : JSON.stringify({ expiration: params.expiration });
    return parseOrThrow(
      CreateSnapshotResponse,
      await this.request(url, {
        method: "POST",
        body,
        signal: params.signal,
      }),
    );
  }

  async deleteSnapshot(params: {
    snapshotId: string;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof SnapshotResponse>>> {
    const url = `/v2/sandboxes/snapshots/${params.snapshotId}`;
    return parseOrThrow(
      SnapshotResponse,
      await this.request(url, { method: "DELETE", signal: params.signal }),
    );
  }

  async getSnapshot(params: {
    snapshotId: string;
    signal?: AbortSignal;
  }): Promise<Parsed<z.infer<typeof SnapshotResponse>>> {
    const url = `/v2/sandboxes/snapshots/${params.snapshotId}`;
    return parseOrThrow(
      SnapshotResponse,
      await this.request(url, { signal: params.signal }),
    );
  }

  async getSandbox(params: WithPrivate<{
    name: string;
    projectId: string;
    resume?: boolean;
    signal?: AbortSignal;
  }>) {
    const privateParams = getPrivateParams(params);
    const query: Record<string, string | undefined> = {
      projectId: params.projectId,
      ...privateParams,
    };
    if (params.resume !== undefined) {
      query.resume = String(params.resume);
    }
    return parseOrThrow(
      SandboxAndSessionResponse,
      await this.request(`/v2/sandboxes/${encodeURIComponent(params.name)}`, {
        query,
        signal: params.signal,
      }),
    );
  }

  async listSandboxes(params: {
    projectId: string;
    limit?: number;
    sortBy?: "createdAt" | "name" | "statusUpdatedAt";
    sortOrder?: "asc" | "desc";
    namePrefix?: string;
    cursor?: string;
    tags?: Record<string, string>;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      SandboxesPaginationResponse,
      await this.request(`/v2/sandboxes`, {
        query: {
          project: params.projectId,
          limit: params.limit,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          namePrefix: params.namePrefix,
          cursor: params.cursor,
          tags: toTagsFilter(params.tags),
        },
        method: "GET",
        signal: params.signal,
      }),
    );
  }

  async updateSandbox(params: {
    name: string;
    projectId: string;
    persistent?: boolean;
    resources?: { vcpus?: number; memory?: number };
    runtime?: RUNTIMES | (string & {});
    timeout?: number;
    networkPolicy?: NetworkPolicy;
    tags?: Record<string, string>;
    snapshotExpiration?: number;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      UpdateSandboxResponse,
      await this.request(`/v2/sandboxes/${encodeURIComponent(params.name)}`, {
        method: "PATCH",
        query: {
          projectId: params.projectId,
        },
        body: JSON.stringify({
          persistent: params.persistent,
          resources: params.resources,
          runtime: params.runtime,
          timeout: params.timeout,
          networkPolicy: params.networkPolicy
            ? toAPINetworkPolicy(params.networkPolicy)
            : undefined,
          tags: params.tags,
          snapshotExpiration: params.snapshotExpiration,
        }),
        signal: params.signal,
      }),
    );
  }

  async deleteSandbox(params: {
    name: string;
    projectId: string;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      UpdateSandboxResponse,
      await this.request(`/v2/sandboxes/${encodeURIComponent(params.name)}`, {
        method: "DELETE",
        query: {
          projectId: params.projectId,
        },
        signal: params.signal,
      }),
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

function toTagsFilter(
  tags: Record<string, string> | undefined,
): string[] | undefined {
  if (tags === undefined) return undefined;
  const entries = Object.entries(tags);
  if (entries.length === 0) return undefined;
  return entries.map(([key, value]) => `${key}:${value}`);
}
