import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { Sandbox, Command } from "@vercel/sandbox";
import type {
  ProxyHandler,
  ProxyHandle,
  ConnectHandler,
  AttachOptions,
  ConnectionInfo,
} from "./types.js";
import {
  type IncomingMessage,
  type OutgoingMessage,
  type ProxyRequest,
  type ConnectRequest,
  requestToProtocol,
  responseToProtocol,
} from "./protocol.js";

const SERVER_BIN_NAME = "vc-http-proxy-server";

interface Session {
  sessionId: string;
  handler: ProxyHandler;
  connectHandler?: ConnectHandler;
}

/**
 * WsProxy manages an HTTP proxy inside a Vercel Sandbox.
 * It uploads a Go binary, starts it, connects via WebSocket,
 * and routes proxied requests to per-session JS callbacks.
 */
export class WsProxy {
  private ws: WebSocket | null = null;
  private command: Command | null = null;
  private sandbox: Sandbox | null = null;
  private proxyPort: number = 0;
  private sessions: Map<string, Session> = new Map();
  private attached: boolean = false;

  /**
   * Upload the Go binary to the sandbox, start it, and connect via WebSocket.
   * If a proxy server is already running (from another client), connects to it.
   */
  async attach(sandbox: Sandbox, opts: AttachOptions): Promise<void> {
    this.sandbox = sandbox;

    // Check if server is already running by reading config file
    const existingInfo = await this.readExistingConfig(sandbox, opts.signal);

    let connectionInfo: ConnectionInfo;

    if (existingInfo) {
      connectionInfo = existingInfo;
      // Try connecting to the existing server
      const domain = sandbox.domain(opts.wsPort);
      const wsUrl = `wss://${domain.replace(/^https?:\/\//, "")}/ws?token=${connectionInfo.token}`;
      try {
        await this.connectWebSocket(wsUrl);
        this.proxyPort = connectionInfo.proxyPort;
        this.attached = true;
        return;
      } catch {
        // Stale config — server is gone. Clean up and start fresh.
        await sandbox.runCommand({
          cmd: "rm",
          args: ["-f", WsProxy.CONFIG_PATH],
          signal: opts.signal,
        }).catch(() => {});
      }
    }

    // Install binary if not already present
    await this.ensureBinaryInstalled(sandbox, opts.signal);

    // Start the server
    const args = [`--ws-port=${opts.wsPort}`];
    if (opts.proxyPort) {
      args.push(`--proxy-port=${opts.proxyPort}`);
    }
    if (opts.debug) {
      args.push("--debug");
    }

    this.command = await sandbox.runCommand({
      cmd: SERVER_BIN_NAME,
      args,
      sudo: true, // needs root for CA cert installation in trust store
      detached: true,
      signal: opts.signal,
    });

    connectionInfo = await this.readConnectionInfo(opts.signal);
    this.proxyPort = connectionInfo.proxyPort;

    const domain = sandbox.domain(opts.wsPort);
    const wsUrl = `wss://${domain.replace(/^https?:\/\//, "")}/ws?token=${connectionInfo.token}`;

    await this.connectWebSocket(wsUrl);
    this.attached = true;
  }

  /**
   * Register a request handler and return a proxy handle.
   * Each call creates a unique session so different `runCommand` calls
   * can have different handlers.
   *
   * The returned object has:
   * - `url`: the raw proxy URL string
   * - `env`: a record with all proxy env vars set (HTTP_PROXY, http_proxy, HTTPS_PROXY, https_proxy)
   * - `toString()`: returns the URL (for backward compat / string coercion)
   */
  async handle(
    handler: ProxyHandler,
    connectHandler?: ConnectHandler,
  ): Promise<ProxyHandle> {
    if (!this.attached) {
      throw new Error(
        "WsProxy is not attached. Call attach() before handle().",
      );
    }

    const sessionId = randomUUID();
    this.sessions.set(sessionId, { sessionId, handler, connectHandler });

    // Tell the Go server we own this session and wait for ack
    await this.registerAndWait(sessionId);

    const url = `http://${sessionId}:x@127.0.0.1:${this.proxyPort}`;
    return {
      url,
      env: {
        HTTP_PROXY: url,
        http_proxy: url,
        HTTPS_PROXY: url,
        https_proxy: url,
      },
      toString() {
        return url;
      },
    };
  }

  private registerAndWait(sessionId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          if (
            msg.type === "register-ack" &&
            msg.sessionIds?.includes(sessionId)
          ) {
            this.ws?.removeListener("message", onMessage);
            resolve();
          }
        } catch {
          // ignore
        }
      };
      this.ws?.on("message", onMessage);
      this.send({ type: "register", sessionIds: [sessionId] });
    });
  }

  /**
   * Remove a previously registered handler by its HTTP_PROXY value.
   */
  removeHandle(handle: ProxyHandle | string): void {
    const url = typeof handle === "string" ? handle : handle.url;
    const match = url.match(/^http:\/\/([^:]+):x@/);
    if (match) {
      const sessionId = match[1];
      this.sessions.delete(sessionId);
      this.send({ type: "unregister", sessionIds: [sessionId] });
    }
  }

  /**
   * Disconnect WebSocket and stop the proxy server.
   */
  async close(): Promise<void> {
    this.sessions.clear();
    this.attached = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.command) {
      try {
        await this.command.kill();
      } catch {
        // Ignore kill errors
      }
      this.command = null;

      // Clean up config file since we started the server
      if (this.sandbox) {
        await this.sandbox.runCommand({
          cmd: "rm",
          args: ["-f", WsProxy.CONFIG_PATH],
        }).catch(() => {});
      }
    }
    this.sandbox = null;
  }

  // ------- Private methods -------

  private static readonly CONFIG_PATH = "/tmp/vercel/http-proxy/config.json";

  private async readExistingConfig(
    sandbox: Sandbox,
    signal?: AbortSignal,
  ): Promise<ConnectionInfo | null> {
    try {
      // Fast sentinel check — avoids full cat+parse if server isn't running
      const check = await sandbox.runCommand({
        cmd: "test",
        args: ["-f", WsProxy.CONFIG_PATH],
        signal,
      });
      if (check.exitCode !== 0) return null;

      const result = await sandbox.runCommand({
        cmd: "cat",
        args: [WsProxy.CONFIG_PATH],
        signal,
      });
      if (result.exitCode === 0) {
        const stdout = await result.stdout();
        if (stdout.trim()) {
          return JSON.parse(stdout.trim()) as ConnectionInfo;
        }
      }
    } catch {
      // Config doesn't exist or is invalid
    }
    return null;
  }

  private async ensureBinaryInstalled(
    sandbox: Sandbox,
    signal?: AbortSignal,
  ): Promise<void> {
    const check = await sandbox.runCommand({
      cmd: "command",
      args: ["-v", SERVER_BIN_NAME],
      signal,
    });

    if (check.exitCode === 0) {
      return; // Already installed
    }

    // Upload the binary
    const pathname = `/tmp/vc-http-proxy-server-${randomUUID()}`;
    const currentPath = import.meta.url;
    const binaryPath =
      process.env.VERCEL_DEV !== "0"
        ? new URL("../dist/http-proxy-server-linux-x86_64", currentPath)
        : new URL("./http-proxy-server-linux-x86_64", currentPath);

    const content = await fs.readFile(binaryPath);
    await sandbox.writeFiles([{ path: pathname, content }], { signal });

    await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `mv "${pathname}" /usr/local/bin/${SERVER_BIN_NAME}; chmod +x /usr/local/bin/${SERVER_BIN_NAME}`,
      ],
      sudo: true,
      signal,
    });
  }

  private async readConnectionInfo(
    signal?: AbortSignal,
  ): Promise<ConnectionInfo> {
    if (!this.command) {
      throw new Error("Server command not started");
    }

    // Read stdout to get the JSON connection info
    for await (const log of this.command.logs({ signal })) {
      if (log.stream === "stdout" && log.data.trim()) {
        try {
          return JSON.parse(log.data.trim()) as ConnectionInfo;
        } catch {
          // Not JSON yet, keep reading
        }
      }
    }

    throw new Error("Server exited without outputting connection info");
  }

  private async connectWebSocket(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);

      ws.on("open", () => {
        this.ws = ws;
        // Send ready message
        const ready: OutgoingMessage = { type: "ready" };
        ws.send(JSON.stringify(ready));
        resolve();
      });

      ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      ws.on("error", (err) => {
        if (!this.ws) {
          reject(err);
        }
      });

      ws.on("close", () => {
        this.ws = null;
        this.attached = false;
      });
    });
  }

  private async handleMessage(raw: string): Promise<void> {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "request":
        await this.handleProxyRequest(msg);
        break;
      case "connect":
        await this.handleConnectRequest(msg);
        break;
    }
  }

  private async handleProxyRequest(msg: ProxyRequest): Promise<void> {
    const session = this.sessions.get(msg.sessionId);

    if (!session) {
      this.send({
        type: "error",
        requestId: msg.requestId,
        message: `No handler registered for session ${msg.sessionId}`,
      });
      return;
    }

    try {
      const request = await requestToProtocol(msg);
      const response = await session.handler(request);
      const protoResponse = await responseToProtocol(
        msg.requestId,
        response,
      );
      this.send(protoResponse);
    } catch (err) {
      this.send({
        type: "error",
        requestId: msg.requestId,
        message:
          err instanceof Error ? err.message : "Unknown handler error",
      });
    }
  }

  private async handleConnectRequest(msg: ConnectRequest): Promise<void> {
    const session = this.sessions.get(msg.sessionId);

    if (!session) {
      this.send({
        type: "error",
        requestId: msg.requestId,
        message: `No handler registered for session ${msg.sessionId}`,
      });
      return;
    }

    try {
      let allow = true;
      if (session.connectHandler) {
        allow = await session.connectHandler(msg.host);
      }
      this.send({
        type: "connect-response",
        requestId: msg.requestId,
        allow,
      });
    } catch (err) {
      this.send({
        type: "error",
        requestId: msg.requestId,
        message:
          err instanceof Error ? err.message : "Unknown handler error",
      });
    }
  }

  private send(msg: OutgoingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
