import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BaseClient } from "./base-client.js";

class TestClient extends BaseClient {
  get(path: string) {
    return this.request(path);
  }
}

describe("BaseClient", () => {
  let server: Server;
  let connections: number;
  let baseUrl: string;

  beforeEach(async () => {
    connections = 0;
    server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
    server.on("connection", () => connections++);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reuses the keep-alive connection for back-to-back requests", async () => {
    const client = new TestClient({ baseUrl });

    // Mirrors `Sandbox.create` followed immediately by `runCommand`: the
    // second request is dispatched as soon as the first body is read.
    for (let i = 0; i < 3; i++) {
      const response = await client.get("/v2/sandboxes");
      await response.text();
    }

    expect(connections).toBe(1);
  });
});
