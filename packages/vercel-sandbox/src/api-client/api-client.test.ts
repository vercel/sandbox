import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APIClient } from "./api-client.js";
import { APIError, StreamError } from "./api-error.js";
import { createNdjsonStream } from "../../test-utils/mock-response.js";
import { z } from "zod";

describe("APIClient", () => {
  describe("getLogs", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("yields stdout log lines", async () => {
      const logLines = [
        { stream: "stdout", data: "hello" },
        { stream: "stdout", data: "world" },
      ];

      mockFetch.mockResolvedValue(
        new Response(createNdjsonStream(logLines), {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const logs = client.getLogs({ sessionId: "sbx_123", cmdId: "cmd_456" });
      const results: Array<{ stream: string; data: string }> = [];

      for await (const log of logs) {
        results.push(log);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ stream: "stdout", data: "hello" });
      expect(results[1]).toEqual({ stream: "stdout", data: "world" });
    });

    it("yields stderr log lines", async () => {
      const logLines = [{ stream: "stderr", data: "Error" }];

      mockFetch.mockResolvedValue(
        new Response(createNdjsonStream(logLines), {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const logs = client.getLogs({ sessionId: "sbx_123", cmdId: "cmd_456" });
      const results: Array<{ stream: string; data: string }> = [];

      for await (const log of logs) {
        results.push(log);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        stream: "stderr",
        data: "Error",
      });
    });

    it("throws APIError when content-type is not application/x-ndjson", async () => {
      mockFetch.mockResolvedValue(
        new Response(null, {
          headers: { "content-type": "application/json" },
        }),
      );

      const logs = client.getLogs({ sessionId: "sbx_123", cmdId: "cmd_456" });

      await expect(async () => {
        for await (const _ of logs) {
        }
      }).rejects.toThrow(APIError);
    });

    it("throws APIError when response status is not ok", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "gone" }), {
          status: 410,
          headers: { "content-type": "application/json" },
        }),
      );

      const logs = client.getLogs({ sessionId: "sbx_123", cmdId: "cmd_456" });

      try {
        for await (const _ of logs) {
        }
        expect.fail("Expected APIError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(APIError);
        expect(err.message).toBe("Status code 410 is not ok");
        expect(err.json).toEqual({
          error: "gone",
        });
      }
    });

    it("throws APIError when response body is null", async () => {
      mockFetch.mockResolvedValue(
        new Response(null, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const logs = client.getLogs({ sessionId: "sbx_123", cmdId: "cmd_456" });

      await expect(async () => {
        for await (const _ of logs) {
        }
      }).rejects.toThrow(APIError);
    });

    it("throws StreamError when error log line is received", async () => {
      const logLines = [
        { stream: "stdout", data: "some logs" },
        {
          stream: "error",
          data: {
            code: "sandbox_stream_closed",
            message: "Sandbox stream was closed and is not accepting commands.",
          },
        },
      ];

      mockFetch.mockResolvedValue(
        new Response(createNdjsonStream(logLines), {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const logs = client.getLogs({ sessionId: "sbx_123", cmdId: "cmd_456" });
      const results: Array<{ stream: string; data: string }> = [];

      await expect(async () => {
        for await (const log of logs) {
          results.push(log);
        }
      }).rejects.toThrow(StreamError);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ stream: "stdout", data: "some logs" });
    });

    it("includes sessionId in APIError", async () => {
      mockFetch.mockResolvedValue(
        new Response(null, {
          headers: { "content-type": "application/json" },
        }),
      );

      const logs = client.getLogs({ sessionId: "sbx_123", cmdId: "cmd_456" });

      try {
        for await (const _ of logs) {
        }
        expect.fail("Expected APIError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(APIError);
        expect((err as APIError<unknown>).sessionId).toBe("sbx_123");
      }
    });

    it("includes sessionId in StreamError", async () => {
      const logLines = [
        {
          stream: "error",
          data: {
            code: "sandbox_stopped",
            message: "Sandbox has stopped",
          },
        },
      ];

      mockFetch.mockResolvedValue(
        new Response(createNdjsonStream(logLines), {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const logs = client.getLogs({ sessionId: "sbx_123", cmdId: "cmd_456" });

      try {
        for await (const _ of logs) {
        }
        expect.fail("Expected StreamError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(StreamError);
        expect((err as StreamError).sessionId).toBe("sbx_123");
      }
    });
  });

  describe("runCommand", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("streams command data when wait is true", async () => {
      const first = {
        command: {
          id: "cmd_123",
          name: "echo",
          args: ["hello"],
          cwd: "/",
          sessionId: "sbx_123",
          exitCode: null,
          startedAt: 1,
        },
      };
      const second = {
        command: {
          ...first.command,
          exitCode: 0,
        },
      };

      mockFetch.mockResolvedValue(
        new Response(createNdjsonStream([first, second]), {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const result = await client.runCommand({
        sessionId: "sbx_123",
        command: "echo",
        args: ["hello"],
        env: {},
        sudo: false,
        wait: true,
      });

      expect(result.command.exitCode).toBeNull();
      await expect(result.finished).resolves.toMatchObject({ exitCode: 0 });
    });

    it("throws APIError when response status is not ok", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "gone" }), {
          status: 410,
          headers: { "content-type": "application/json" },
        }),
      );

      try {
        await client.runCommand({
          sessionId: "sbx_123",
          command: "echo",
          args: ["hello"],
          env: {},
          sudo: false,
          wait: true,
        });
        expect.fail("Expected APIError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(APIError);
        expect(err.message).toBe("Status code 410 is not ok");
        expect(err.json).toEqual({
          error: "gone",
        });
      }
    });

    it("throws abort error (not Zod error) when signal aborts before stream finishes", async () => {
      const commandData = {
        command: {
          id: "cmd_123",
          name: "python3",
          args: ["script.py"],
          cwd: "/",
          sessionId: "sbx_123",
          exitCode: null,
          startedAt: 1,
        },
      };

      const encoder = new TextEncoder();
      const firstChunk = JSON.stringify(commandData) + "\n";
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(firstChunk));
        },
        cancel() {},
      });

      mockFetch.mockResolvedValue(
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const controller = new AbortController();
      const result = await client.runCommand({
        sessionId: "sbx_123",
        command: "python3",
        args: ["script.py"],
        env: {},
        sudo: false,
        wait: true,
        signal: controller.signal,
      });

      expect(result.command.id).toBe("cmd_123");

      controller.abort();

      await expect(result.finished).rejects.toThrow();
      await expect(result.finished).rejects.not.toBeInstanceOf(z.ZodError);
    }, 10000);

    it("throws StreamError when stream closes before finished chunk arrives", async () => {
      const commandData = {
        command: {
          id: "cmd_123",
          name: "python3",
          args: ["script.py"],
          cwd: "/",
          sessionId: "sbx_123",
          exitCode: null,
          startedAt: 1,
        },
      };

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(JSON.stringify(commandData) + "\n"),
          );
          controller.close();
        },
      });

      mockFetch.mockResolvedValue(
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const result = await client.runCommand({
        sessionId: "sbx_123",
        command: "python3",
        args: ["script.py"],
        env: {},
        sudo: false,
        wait: true,
      });

      expect(result.command.id).toBe("cmd_123");

      await expect(result.finished).rejects.toThrow(
        "Stream ended before command finished",
      );
      await expect(result.finished).rejects.toBeInstanceOf(StreamError);
    });

    it("rejects when signal is already aborted before stream starts", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start() {},
        cancel() {},
      });

      mockFetch.mockResolvedValue(
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.runCommand({
          sessionId: "sbx_123",
          command: "python3",
          args: ["script.py"],
          env: {},
          sudo: false,
          wait: true,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });
  });

  describe("stopSession", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSession = (status: string) => ({
      id: "sbx_123",
      memory: 2048,
      vcpus: 1,
      region: "iad1",
      runtime: "node24",
      timeout: 300000,
      status,
      requestedAt: Date.now(),
      createdAt: Date.now(),
      cwd: "/",
      updatedAt: Date.now(),
    });

    const makeSandbox = () => ({
      name: "my-sandbox",
      persistent: true,
      region: "iad1",
      vcpus: 1,
      memory: 2048,
      runtime: "node24",
      timeout: 300000,
      totalActiveCpuDurationMs: 1200,
      totalIngressBytes: 1200000,
      totalEgressBytes: 3400000,
      totalDurationMs: 45000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentSessionId: "sbx_123",
      currentSnapshotId: "snap_456",
      status: "stopped" as const,
    });

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("returns session from stop response", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ session: makeSession("stopped") }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.stopSession({ sessionId: "sbx_123" });

      expect(result.json.session.status).toBe("stopped");
      expect(result.json.sandbox).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("parses sandbox metadata from stop response", async () => {
      const sandbox = makeSandbox();
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ session: makeSession("stopped"), sandbox }),
          { headers: { "content-type": "application/json" } },
        ),
      );

      const result = await client.stopSession({ sessionId: "sbx_123" });

      expect(result.json.session.status).toBe("stopped");
      expect(result.json.sandbox).toBeDefined();
      expect(result.json.sandbox?.name).toBe("my-sandbox");
      expect(result.json.sandbox?.totalActiveCpuDurationMs).toBe(1200);
      expect(result.json.sandbox?.totalIngressBytes).toBe(1200000);
      expect(result.json.sandbox?.totalEgressBytes).toBe(3400000);
      expect(result.json.sandbox?.totalDurationMs).toBe(45000);
      expect(result.json.sandbox?.currentSnapshotId).toBe("snap_456");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSandbox", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSandboxMetadata = () => ({
      name: "my-sandbox",
      persistent: true,
      region: "iad1",
      vcpus: 1,
      memory: 2048,
      runtime: "node24",
      timeout: 300000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "running" as const,
      currentSessionId: "sbx_123",
    });

    const makeSession = () => ({
      id: "sbx_123",
      memory: 2048,
      vcpus: 1,
      region: "iad1",
      runtime: "node24",
      timeout: 300000,
      status: "running",
      requestedAt: Date.now(),
      createdAt: Date.now(),
      cwd: "/",
      updatedAt: Date.now(),
    });

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("fetches a sandbox by name and projectId", async () => {
      const body = {
        sandbox: makeSandboxMetadata(),
        session: makeSession(),
        routes: [{ url: "https://example.com", subdomain: "sbx", port: 3000 }],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.getSandbox({
        name: "my-sandbox",
        projectId: "proj_123",
      });

      expect(result.json.sandbox.name).toBe("my-sandbox");
      expect(result.json.session.id).toBe("sbx_123");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/v2/sandboxes/my-sandbox");
      expect(url).toContain("projectId=proj_123");
    });

    it("passes resume query param when provided", async () => {
      const body = {
        sandbox: makeSandboxMetadata(),
        session: makeSession(),
        routes: [],
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      await client.getSandbox({
        name: "my-sandbox",
        projectId: "proj_123",
        resume: true,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("resume=true");
    });
  });

  describe("listSandboxes", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSandboxMetadata = (name: string) => ({
      name,
      persistent: false,
      region: "iad1",
      vcpus: 1,
      memory: 2048,
      runtime: "node24",
      timeout: 300000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "running" as const,
      currentSessionId: "sbx_123",
    });

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("lists sandboxes with pagination", async () => {
      const body = {
        sandboxes: [makeSandboxMetadata("sb-1"), makeSandboxMetadata("sb-2")],
        pagination: { count: 2, next: null },
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.listSandboxes({
        projectId: "proj_123",
      });

      expect(result.json.sandboxes).toHaveLength(2);
      expect(result.json.sandboxes[0].name).toBe("sb-1");
      expect(result.json.pagination.count).toBe(2);
    });

    it("passes all query params", async () => {
      const body = {
        sandboxes: [],
        pagination: { count: 0, next: null },
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      await client.listSandboxes({
        projectId: "proj_123",
        limit: 5,
        sortBy: "name",
        namePrefix: "test-",
        cursor: "abc",
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("project=proj_123");
      expect(url).toContain("limit=5");
      expect(url).toContain("sortBy=name");
      expect(url).toContain("namePrefix=test-");
      expect(url).toContain("cursor=abc");
    });

    it("passes sortOrder and sortBy statusUpdatedAt", async () => {
      const body = {
        sandboxes: [makeSandboxMetadata("sb-1")],
        pagination: { count: 1, next: null },
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      await client.listSandboxes({
        projectId: "proj_123",
        sortBy: "statusUpdatedAt",
        sortOrder: "desc",
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("sortBy=statusUpdatedAt");
      expect(url).toContain("sortOrder=desc");
    });
  });

  describe("listSessions", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSession = () => ({
      id: "sbx_123",
      memory: 2048,
      vcpus: 1,
      region: "iad1",
      runtime: "node24",
      timeout: 300000,
      status: "running",
      requestedAt: Date.now(),
      createdAt: Date.now(),
      cwd: "/",
      updatedAt: Date.now(),
    });

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("lists sessions with cursor pagination", async () => {
      const body = {
        sessions: [makeSession()],
        pagination: { count: 1, next: null },
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.listSessions({
        projectId: "proj_123",
      });

      expect(result.json.sessions).toHaveLength(1);
      expect(result.json.pagination.count).toBe(1);
      expect(result.json.pagination.next).toBeNull();
    });

    it("passes cursor and sortOrder params", async () => {
      const body = {
        sessions: [],
        pagination: { count: 0, next: null },
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      await client.listSessions({
        projectId: "proj_123",
        cursor: "cursor_abc",
        sortOrder: "asc",
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("cursor=cursor_abc");
      expect(url).toContain("sortOrder=asc");
    });
  });

  describe("listSnapshots", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSnapshot = () => ({
      id: "snap_123",
      sourceSessionId: "sbx_123",
      region: "iad1",
      status: "created",
      sizeBytes: 1024,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("lists snapshots with cursor pagination", async () => {
      const body = {
        snapshots: [makeSnapshot()],
        pagination: { count: 1, next: null },
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.listSnapshots({
        projectId: "proj_123",
      });

      expect(result.json.snapshots).toHaveLength(1);
      expect(result.json.pagination.count).toBe(1);
      expect(result.json.pagination.next).toBeNull();
    });

    it("passes cursor and sortOrder params", async () => {
      const body = {
        snapshots: [],
        pagination: { count: 0, next: null },
      };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      await client.listSnapshots({
        projectId: "proj_123",
        cursor: "cursor_xyz",
        sortOrder: "desc",
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("cursor=cursor_xyz");
      expect(url).toContain("sortOrder=desc");
    });
  });

  describe("updateSandbox", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSandboxMetadata = () => ({
      name: "my-sandbox",
      persistent: true,
      region: "iad1",
      vcpus: 2,
      memory: 4096,
      runtime: "node24",
      timeout: 600000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "running" as const,
      currentSessionId: "sbx_123",
      snapshotExpiration: 604800000,
    });

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("sends PATCH with update fields", async () => {
      const body = { sandbox: makeSandboxMetadata() };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.updateSandbox({
        name: "my-sandbox",
        projectId: "proj_123",
        persistent: true,
        timeout: 600000,
        snapshotExpiration: 604800000,
        currentSnapshotId: "snap_abc123",
      });

      expect(result.json.sandbox.name).toBe("my-sandbox");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/v2/sandboxes/my-sandbox");
      expect(url).toContain("projectId=proj_123");
      expect(opts.method).toBe("PATCH");

      const parsedBody = JSON.parse(opts.body);
      expect(parsedBody.persistent).toBe(true);
      expect(parsedBody.timeout).toBe(600000);
      expect(parsedBody.snapshotExpiration).toBe(604800000);
      expect(parsedBody.currentSnapshotId).toBe("snap_abc123");
    });
  });

  describe("deleteSandbox", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSandboxMetadata = () => ({
      name: "my-sandbox",
      persistent: false,
      region: "iad1",
      vcpus: 1,
      memory: 2048,
      runtime: "node24",
      timeout: 300000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "running" as const,
      currentSessionId: "sbx_123",
    });

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("sends DELETE with projectId", async () => {
      const body = { sandbox: makeSandboxMetadata() };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.deleteSandbox({
        name: "my-sandbox",
        projectId: "proj_123",
      });

      expect(result.json.sandbox.name).toBe("my-sandbox");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/v2/sandboxes/my-sandbox");
      expect(url).toContain("projectId=proj_123");
      expect(opts.method).toBe("DELETE");
    });
  });

  describe("createSnapshot", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("sends zero expiration for no expiration", async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            session: {
              id: "sbx_123",
              memory: 2048,
              vcpus: 1,
              region: "iad1",
              runtime: "node24",
              timeout: 300000,
              status: "running",
              requestedAt: Date.now(),
              createdAt: Date.now(),
              cwd: "/",
              updatedAt: Date.now(),
            },
            snapshot: {
              id: "snap_123",
              sourceSessionId: "sbx_123",
              region: "iad1",
              status: "created",
              sizeBytes: 1024,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

      await client.createSnapshot({
        sessionId: "sbx_123",
        expiration: 0,
      });

      expect(mockFetch.mock.calls[0]?.[1]?.body).toBe(
        JSON.stringify({ expiration: 0 }),
      );
    });
  });

  describe("deleteSnapshot", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const snapshotResponse = () =>
      new Response(
        JSON.stringify({
          snapshot: {
            id: "snap_123",
            sourceSessionId: "sbx_123",
            region: "iad1",
            status: "deleted",
            sizeBytes: 1024,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        }),
        { headers: { "content-type": "application/json" } },
      );

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("does not send forceDelete query param by default", async () => {
      mockFetch.mockResolvedValue(snapshotResponse());

      await client.deleteSnapshot({ snapshotId: "snap_123" });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(String(url)).toContain("/v2/sandboxes/snapshots/snap_123");
      expect(String(url)).not.toContain("forceDelete");
      expect(opts.method).toBe("DELETE");
    });

    it("appends forceDelete=true when forceDelete is set", async () => {
      mockFetch.mockResolvedValue(snapshotResponse());

      await client.deleteSnapshot({
        snapshotId: "snap_123",
        forceDelete: true,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(String(url)).toContain("forceDelete=true");
    });

    it("omits forceDelete when explicitly false", async () => {
      mockFetch.mockResolvedValue(snapshotResponse());

      await client.deleteSnapshot({
        snapshotId: "snap_123",
        forceDelete: false,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(String(url)).not.toContain("forceDelete");
    });
  });

  describe("createSandbox with snapshotKeepLast", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const sandboxResponse = () =>
      new Response(
        JSON.stringify({
          sandbox: {
            name: "my-sandbox",
            persistent: true,
            region: "iad1",
            vcpus: 1,
            memory: 2048,
            runtime: "node24",
            timeout: 300000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: "running",
            currentSessionId: "sbx_123",
            snapshotKeepLast: {
              count: 3,
              expiration: 604800000,
              deleteEvicted: true,
            },
          },
          session: {
            id: "sbx_123",
            memory: 2048,
            vcpus: 1,
            region: "iad1",
            runtime: "node24",
            timeout: 300000,
            status: "running",
            requestedAt: Date.now(),
            createdAt: Date.now(),
            cwd: "/",
            updatedAt: Date.now(),
          },
          routes: [],
        }),
        { headers: { "content-type": "application/json" } },
      );

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("forwards snapshotKeepLast in the request body", async () => {
      mockFetch.mockResolvedValue(sandboxResponse());

      await client.createSandbox({
        projectId: "proj_123",
        snapshotKeepLast: {
          count: 3,
          expiration: 604800000,
          deleteEvicted: true,
        },
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.snapshotKeepLast).toEqual({
        count: 3,
        expiration: 604800000,
        deleteEvicted: true,
      });
    });

    it("omits snapshotKeepLast when not provided", async () => {
      mockFetch.mockResolvedValue(sandboxResponse());

      await client.createSandbox({ projectId: "proj_123" });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body).not.toHaveProperty("snapshotKeepLast");
    });
  });

  describe("updateSandbox with snapshotKeepLast", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSandboxMetadata = () => ({
      name: "my-sandbox",
      persistent: true,
      region: "iad1",
      vcpus: 2,
      memory: 4096,
      runtime: "node24",
      timeout: 600000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "running" as const,
      currentSessionId: "sbx_123",
    });

    beforeEach(() => {
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    it("forwards snapshotKeepLast in the PATCH body", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ sandbox: makeSandboxMetadata() }), {
          headers: { "content-type": "application/json" },
        }),
      );

      await client.updateSandbox({
        name: "my-sandbox",
        projectId: "proj_123",
        snapshotKeepLast: { count: 5, expiration: 0, deleteEvicted: false },
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.snapshotKeepLast).toEqual({
        count: 5,
        expiration: 0,
        deleteEvicted: false,
      });
    });

    it("sends null to clear snapshotKeepLast", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ sandbox: makeSandboxMetadata() }), {
          headers: { "content-type": "application/json" },
        }),
      );

      await client.updateSandbox({
        name: "my-sandbox",
        projectId: "proj_123",
        snapshotKeepLast: null,
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      // Presence of the key with null — not undefined/missing — is the signal.
      expect(Object.prototype.hasOwnProperty.call(body, "snapshotKeepLast")).toBe(
        true,
      );
      expect(body.snapshotKeepLast).toBeNull();
    });
  });
});
