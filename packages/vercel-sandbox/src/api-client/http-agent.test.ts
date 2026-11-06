import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpAgent } from "./http-agent.js";

function hasOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Generates a throwaway self-signed certificate for 127.0.0.1. */
function selfSignedCert() {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-sdk-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    return {
      key: readFileSync(join(dir, "key.pem")),
      cert: readFileSync(join(dir, "cert.pem")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe.skipIf(!hasOpenssl())("createHttpAgent", () => {
  let tlsOptions: { key: Buffer; cert: Buffer };

  beforeAll(() => {
    tlsOptions = selfSignedCert();
  });

  type Handler = (
    req: unknown,
    res: { end(body: string): void },
  ) => Promise<void>;

  /**
   * Starts a server whose handler holds every response open until
   * `release()` is called, and counts arrivals and TLS connections.
   */
  async function startServer(
    create: (handler: Handler) => https.Server | http2.Http2SecureServer,
  ) {
    let connections = 0;
    let arrived = 0;
    let gate = deferred();
    let waiter: { expected: number; resolve: () => void } | undefined;
    const server = create(async (_req, res) => {
      arrived++;
      if (waiter && arrived >= waiter.expected) waiter.resolve();
      await gate.promise;
      res.end("ok");
    });
    server.on("secureConnection", () => connections++);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    return {
      url: `https://127.0.0.1:${(server.address() as AddressInfo).port}/`,
      connections: () => connections,
      release: () => {
        gate.resolve();
        gate = deferred();
      },
      waitForArrivals: (expected: number) =>
        new Promise<void>((resolve) => {
          waiter = { expected, resolve };
          if (arrived >= expected) resolve();
        }),
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          if ("closeAllConnections" in server) server.closeAllConnections();
        }),
    };
  }

  const servers: Array<{ close: () => Promise<void> }> = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it("multiplexes concurrent GET requests over one HTTP/2 connection", async () => {
    const server = await startServer((handler) =>
      http2.createSecureServer({ ...tlsOptions, allowHTTP1: true }, handler),
    );
    servers.push(server);
    const agent = createHttpAgent({ rejectUnauthorized: false });

    // Warm the connection so concurrent requests have one to share.
    const warm = fetch(server.url, { dispatcher: agent }).then((r) => r.text());
    await server.waitForArrivals(1);
    server.release();
    await warm;

    const requests = Array.from({ length: 5 }, () =>
      fetch(server.url, { dispatcher: agent }).then((r) => r.text()),
    );
    // All five are held open by the server at the same time...
    await server.waitForArrivals(6);
    // ...over the single connection opened by the warm-up request.
    expect(server.connections()).toBe(1);
    server.release();
    await expect(Promise.all(requests)).resolves.toEqual(Array(5).fill("ok"));
    await agent.close();
  });

  it.each(["GET", "POST"])(
    "does not queue a POST behind an open %s response",
    async (method) => {
      const server = await startServer((handler) =>
        http2.createSecureServer({ ...tlsOptions, allowHTTP1: true }, handler),
      );
      servers.push(server);
      const agent = createHttpAgent({ rejectUnauthorized: false });
      const writeAgent = createHttpAgent({ rejectUnauthorized: false }, false);
      const first = fetch(server.url, {
        dispatcher: method === "GET" ? agent : writeAgent,
        method,
        body: method === "POST" ? "{}" : undefined,
      }).then((r) => r.text());
      await server.waitForArrivals(1);
      const post = fetch(server.url, {
        dispatcher: writeAgent,
        method: "POST",
        body: "{}",
      }).then((r) => r.text());
      const arrivedBeforeRelease = await Promise.race([
        server.waitForArrivals(2).then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      server.release();
      await first;
      await server.waitForArrivals(2);
      server.release();
      await post;
      await Promise.all([agent.close(), writeAgent.close()]);
      expect(arrivedBeforeRelease).toBe(true);
    },
  );

  it("does not pipeline requests when the server only speaks HTTP/1.1", async () => {
    const server = await startServer((handler) =>
      https.createServer(tlsOptions, handler),
    );
    servers.push(server);
    const agent = createHttpAgent({ rejectUnauthorized: false });

    const warm = fetch(server.url, { dispatcher: agent }).then((r) => r.text());
    await server.waitForArrivals(1);
    server.release();
    await warm;

    const requests = Array.from({ length: 3 }, () =>
      fetch(server.url, { dispatcher: agent }).then((r) => r.text()),
    );
    // Each concurrent request reaches the server without queuing behind
    // another, which over HTTP/1.1 requires one connection per request.
    // (The warm-up socket may or may not be back in the pool yet, so this
    // is at least three rather than exactly three.)
    await server.waitForArrivals(4);
    expect(server.connections()).toBeGreaterThanOrEqual(3);
    server.release();
    await expect(Promise.all(requests)).resolves.toEqual(Array(3).fill("ok"));
    await agent.close();
  });
});
