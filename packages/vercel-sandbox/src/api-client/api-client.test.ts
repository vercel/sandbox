import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APIClient } from "./api-client";
import { APIError, StreamError } from "./api-error";
import { createNdjsonStream } from "../../test-utils/mock-response";

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
        expect(err.message).toBe(
          "Status code 410 is not ok",
        );
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
        expect(err.message).toBe(
          "Status code 410 is not ok",
        );
        expect(err.json).toEqual({
          error: "gone",
        });
      }
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

    beforeEach(() => {
      vi.useFakeTimers();
      mockFetch = vi.fn();
      client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns immediately when blocking is not set", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ session: makeSession("stopping") }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.stopSession({ sessionId: "sbx_123" });

      expect(result.json.session.status).toBe("stopping");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("polls until stopped when blocking is true", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ session: makeSession("stopping") }), {
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ session: makeSession("stopping"), routes: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ session: makeSession("stopped"), routes: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        );

      const promise = client.stopSession({
        sessionId: "sbx_123",
        blocking: true,
      });

      // Advance past the two polling delays
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result.json.session.status).toBe("stopped");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("stops polling on failed status", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ session: makeSession("stopping") }), {
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ session: makeSession("failed"), routes: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        );

      const promise = client.stopSession({
        sessionId: "sbx_123",
        blocking: true,
      });

      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result.json.session.status).toBe("failed");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("stops polling on aborted status", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ session: makeSession("stopping") }), {
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ session: makeSession("aborted"), routes: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        );

      const promise = client.stopSession({
        sessionId: "sbx_123",
        blocking: true,
      });

      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result.json.session.status).toBe("aborted");
      expect(mockFetch).toHaveBeenCalledTimes(2);
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
        pagination: { count: 2, next: null, total: 2 },
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
      expect(result.json.pagination.total).toBe(2);
    });

    it("passes all query params", async () => {
      const body = {
        sandboxes: [],
        pagination: { count: 0, next: null, total: 0 },
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
      });

      expect(result.json.sandbox.name).toBe("my-sandbox");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/v2/sandboxes/my-sandbox");
      expect(url).toContain("projectId=proj_123");
      expect(opts.method).toBe("PATCH");

      const parsedBody = JSON.parse(opts.body);
      expect(parsedBody.persistent).toBe(true);
      expect(parsedBody.timeout).toBe(600000);
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

    it("sends DELETE with projectId and preserveSandboxes=false", async () => {
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
      expect(url).toContain("preserveSandboxes=false");
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
            sandbox: {
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
});
