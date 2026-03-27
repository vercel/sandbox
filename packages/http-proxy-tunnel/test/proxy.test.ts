import {
  describe,
  expect,
  onTestFailed,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { type Readable } from "node:stream";
import * as http from "node:http";
import WebSocket from "ws";

interface ConnectionInfo {
  wsPort: number;
  proxyPort: number;
  token: string;
}

interface ProxyRequest {
  type: "request";
  requestId: string;
  sessionId: string;
  method: string;
  url: string;
  headers: Record<string, string[]>;
  body?: string;
}

interface ConnectRequest {
  type: "connect";
  requestId: string;
  sessionId: string;
  host: string;
}

function testStream(stream: Readable) {
  const buffer: Buffer[] = [];
  onTestFailed(() => {
    const output = Buffer.concat(buffer).toString("utf-8");
    console.log("=== Process stderr ===");
    console.log(output);
    console.log(`=== End stderr (${new Date().toISOString()}) ===`);
  });
  stream.on("data", (chunk: Buffer | string) => {
    buffer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  return buffer;
}

async function startProxy(): Promise<{
  proc: ChildProcess;
  info: ConnectionInfo;
  stderrBuffer: Buffer[];
}> {
  const binaryPath = new URL(
    "../../http-proxy-server/http-proxy-server",
    import.meta.url,
  ).pathname;

  const proc = spawn(binaryPath, ["--debug"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrBuffer = testStream(proc.stderr!);

  onTestFinished(() => {
    proc.kill();
  });

  // Read connection info JSON from stdout
  const info = await new Promise<ConnectionInfo>((resolve, reject) => {
    let data = "";
    proc.stdout!.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      const lines = data.split("\n");
      for (const line of lines) {
        if (line.trim()) {
          try {
            resolve(JSON.parse(line.trim()));
            return;
          } catch {
            // not JSON yet
          }
        }
      }
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== null) reject(new Error(`Process exited with code ${code}`));
    });
    setTimeout(
      () => reject(new Error("Timed out waiting for connection info")),
      10_000,
    );
  });

  return { proc, info, stderrBuffer };
}

async function connectClient(
  wsPort: number,
  token: string,
): Promise<{
  ws: WebSocket;
  messages: (ProxyRequest | ConnectRequest)[];
}> {
  const ws = new WebSocket(
    `ws://localhost:${wsPort}/ws?token=${token}`,
  );

  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  onTestFinished(() => {
    ws.close();
  });

  const messages: (ProxyRequest | ConnectRequest)[] = [];
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request" || msg.type === "connect") {
        messages.push(msg);
      }
    } catch {
      // ignore
    }
  });

  // Send ready
  ws.send(JSON.stringify({ type: "ready" }));

  // Small delay for ready to propagate
  await new Promise((r) => setTimeout(r, 50));

  return { ws, messages };
}

function makeProxiedRequest(
  proxyPort: number,
  sessionId: string,
  targetUrl: string,
  method = "GET",
  body?: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const auth = Buffer.from(`${sessionId}:x`).toString("base64");

    const req = http.request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        path: targetUrl,
        method,
        headers: {
          Host: url.host,
          "Proxy-Authorization": `Basic ${auth}`,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode!,
            headers: res.headers,
            body: data,
          }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function registerSessions(ws: WebSocket, sessionIds: string[]) {
  ws.send(JSON.stringify({ type: "register", sessionIds }));
}

describe("http-proxy-server", () => {
  test("proxies HTTP request and returns callback response", async () => {
    const { info } = await startProxy();
    const { ws, messages } = await connectClient(info.wsPort, info.token);
    registerSessions(ws, ["my-session"]);

    // Handle incoming requests on the WS side
    const originalOnMessage = ws.listeners("message")[0] as Function;
    ws.removeAllListeners("message");
    ws.on("message", (data) => {
      // Call original to populate messages array
      originalOnMessage(data);

      const msg = JSON.parse(data.toString());
      if (msg.type === "request") {
        const body = Buffer.from("hello proxy").toString("base64");
        ws.send(
          JSON.stringify({
            type: "response",
            requestId: msg.requestId,
            status: 200,
            headers: { "X-Test": ["passed"] },
            body,
          }),
        );
      }
    });

    const result = await makeProxiedRequest(
      info.proxyPort,
      "my-session",
      "http://example.com/test",
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe("hello proxy");
    expect(result.headers["x-test"]).toBe("passed");

    await vi.waitFor(() => {
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const req = messages[0] as ProxyRequest;
      expect(req.sessionId).toBe("my-session");
      expect(req.method).toBe("GET");
      expect(req.url).toContain("example.com/test");
    });
  });

  test("routes to correct session based on Proxy-Authorization", async () => {
    const { info } = await startProxy();
    const { ws } = await connectClient(info.wsPort, info.token);
    registerSessions(ws, ["session-a", "session-b"]);

    ws.removeAllListeners("message");
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request") {
        const responseBody =
          msg.sessionId === "session-a" ? "response-a" : "response-b";
        ws.send(
          JSON.stringify({
            type: "response",
            requestId: msg.requestId,
            status: 200,
            body: Buffer.from(responseBody).toString("base64"),
          }),
        );
      }
    });

    const [resultA, resultB] = await Promise.all([
      makeProxiedRequest(info.proxyPort, "session-a", "http://example.com/a"),
      makeProxiedRequest(info.proxyPort, "session-b", "http://example.com/b"),
    ]);

    expect(resultA.body).toBe("response-a");
    expect(resultB.body).toBe("response-b");
  });

  test("handles POST with body", async () => {
    const { info } = await startProxy();
    const { ws } = await connectClient(info.wsPort, info.token);
    registerSessions(ws, ["post-session"]);

    let receivedBody = "";
    ws.removeAllListeners("message");
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request") {
        receivedBody = msg.body
          ? Buffer.from(msg.body, "base64").toString()
          : "";
        ws.send(
          JSON.stringify({
            type: "response",
            requestId: msg.requestId,
            status: 201,
            body: Buffer.from("created").toString("base64"),
          }),
        );
      }
    });

    const result = await makeProxiedRequest(
      info.proxyPort,
      "post-session",
      "http://example.com/api",
      "POST",
      "request-body",
    );

    expect(result.statusCode).toBe(201);
    expect(result.body).toBe("created");
    expect(receivedBody).toBe("request-body");
  });

  test("returns 502 when WS client sends error message", async () => {
    const { info } = await startProxy();
    const { ws } = await connectClient(info.wsPort, info.token);
    registerSessions(ws, ["err-session"]);

    ws.removeAllListeners("message");
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request") {
        ws.send(
          JSON.stringify({
            type: "error",
            requestId: msg.requestId,
            message: "denied by handler",
          }),
        );
      }
    });

    const result = await makeProxiedRequest(
      info.proxyPort,
      "err-session",
      "http://example.com/fail",
    );

    expect(result.statusCode).toBe(502);
    expect(result.body).toContain("denied by handler");
  });

  test("CONNECT request — denied", async () => {
    const { info } = await startProxy();
    const { ws } = await connectClient(info.wsPort, info.token);
    registerSessions(ws, [""]); // empty session for unauthenticated CONNECT

    ws.removeAllListeners("message");
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "connect") {
        ws.send(
          JSON.stringify({
            type: "connect-response",
            requestId: msg.requestId,
            allow: false,
          }),
        );
      }
    });

    const response = await new Promise<string>((resolve) => {
      const socket = new (require("net").Socket)();
      socket.connect(info.proxyPort, "127.0.0.1", () => {
        socket.write(
          "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
        );
      });
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\r\n\r\n")) {
          socket.destroy();
          resolve(data);
        }
      });
    });

    expect(response).toContain("403");
  });

  test("rejects WebSocket with bad token", async () => {
    const { info } = await startProxy();

    const ws = new WebSocket(
      `ws://localhost:${info.wsPort}/ws?token=wrong-token`,
    );

    const error = await new Promise<Event>((resolve) => {
      ws.on("error", resolve);
      ws.on("unexpected-response", (_req, res) => {
        expect(res.statusCode).toBe(401);
        resolve(new Event("rejected"));
      });
    });

    expect(error).toBeTruthy();
  });

  test("returns 502 when no WS client connected", async () => {
    const { info } = await startProxy();
    // Don't connect a WS client

    const result = await makeProxiedRequest(
      info.proxyPort,
      "session",
      "http://example.com/test",
    ).catch((err) => ({ statusCode: 502, headers: {}, body: err.message }));

    expect(result.statusCode).toBe(502);
  });

  test("multi-client: two WS clients with registered sessions route independently", async () => {
    const { info } = await startProxy();

    // Connect client A
    const clientA = await connectClient(info.wsPort, info.token);
    // Connect client B
    const clientB = await connectClient(info.wsPort, info.token);

    // Register sessions
    clientA.ws.send(JSON.stringify({ type: "register", sessionIds: ["session-a"] }));
    clientB.ws.send(JSON.stringify({ type: "register", sessionIds: ["session-b"] }));
    await new Promise((r) => setTimeout(r, 50));

    // Set up handlers
    clientA.ws.removeAllListeners("message");
    clientA.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request") {
        clientA.ws.send(JSON.stringify({
          type: "response",
          requestId: msg.requestId,
          status: 200,
          body: Buffer.from("from-A").toString("base64"),
        }));
      }
    });

    clientB.ws.removeAllListeners("message");
    clientB.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request") {
        clientB.ws.send(JSON.stringify({
          type: "response",
          requestId: msg.requestId,
          status: 200,
          body: Buffer.from("from-B").toString("base64"),
        }));
      }
    });

    const [resultA, resultB] = await Promise.all([
      makeProxiedRequest(info.proxyPort, "session-a", "http://example.com/a"),
      makeProxiedRequest(info.proxyPort, "session-b", "http://example.com/b"),
    ]);

    expect(resultA.body).toBe("from-A");
    expect(resultB.body).toBe("from-B");
  });
});
