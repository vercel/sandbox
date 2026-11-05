import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { BaseClient } from "./base-client.js";

class TestClient extends BaseClient {
  get(path: string) {
    return this.request(path);
  }
}

describe("BaseClient", () => {
  let server: http.Server;
  let baseUrl: string;
  const remotePorts: number[] = [];
  let connections = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      remotePorts.push(req.socket.remotePort!);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ path: req.url }));
    });
    server.on("connection", () => connections++);
    // Send no `Keep-Alive: timeout=N` hint (like the Vercel API), so the
    // client-side idle timeout decides whether a socket survives a gap.
    server.keepAliveTimeout = 0;
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    remotePorts.length = 0;
  });

  it("performs requests with the default fetch when none is injected", async () => {
    const client = new TestClient({ baseUrl });
    const response = await client.get("/v1/ping");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ path: "/v1/ping" });
  });

  it("keeps the connection alive across an idle gap longer than undici's 4s default", async () => {
    const client = new TestClient({ baseUrl });
    await (await client.get("/v1/first")).text();
    const connectionsBeforeGap = connections;
    await new Promise((resolve) => setTimeout(resolve, 4_500));
    await (await client.get("/v1/second")).text();
    expect(remotePorts).toHaveLength(2);
    expect(connections).toBe(connectionsBeforeGap);
  });

  it("honors a globalThis.fetch replaced after module load", async () => {
    const stub = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ stubbed: true })),
    );
    vi.stubGlobal("fetch", stub);
    const client = new TestClient({ baseUrl });
    const response = await client.get("/v1/ping");
    await expect(response.json()).resolves.toEqual({ stubbed: true });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(remotePorts).toHaveLength(0);
  });

  it("prefers an injected fetch over the default", async () => {
    const injected = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ injected: true })),
    );
    const client = new TestClient({ baseUrl, fetch: injected });
    const response = await client.get("/v1/ping");
    await expect(response.json()).resolves.toEqual({ injected: true });
    expect(injected).toHaveBeenCalledTimes(1);
  });
});
