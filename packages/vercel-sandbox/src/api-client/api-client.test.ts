import { describe, it, expect, vi, beforeEach } from "vitest";
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

      const logs = client.getLogs({ sandboxId: "sbx_123", cmdId: "cmd_456" });
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

      const logs = client.getLogs({ sandboxId: "sbx_123", cmdId: "cmd_456" });
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

      const logs = client.getLogs({ sandboxId: "sbx_123", cmdId: "cmd_456" });

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

      const logs = client.getLogs({ sandboxId: "sbx_123", cmdId: "cmd_456" });

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

      const logs = client.getLogs({ sandboxId: "sbx_123", cmdId: "cmd_456" });

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

      const logs = client.getLogs({ sandboxId: "sbx_123", cmdId: "cmd_456" });
      const results: Array<{ stream: string; data: string }> = [];

      await expect(async () => {
        for await (const log of logs) {
          results.push(log);
        }
      }).rejects.toThrow(StreamError);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ stream: "stdout", data: "some logs" });
    });

    it("includes sandboxId in APIError", async () => {
      mockFetch.mockResolvedValue(
        new Response(null, {
          headers: { "content-type": "application/json" },
        }),
      );

      const logs = client.getLogs({ sandboxId: "sbx_123", cmdId: "cmd_456" });

      try {
        for await (const _ of logs) {
        }
        expect.fail("Expected APIError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(APIError);
        expect((err as APIError<unknown>).sandboxId).toBe("sbx_123");
      }
    });

    it("includes sandboxId in StreamError", async () => {
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

      const logs = client.getLogs({ sandboxId: "sbx_123", cmdId: "cmd_456" });

      try {
        for await (const _ of logs) {
        }
        expect.fail("Expected StreamError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(StreamError);
        expect((err as StreamError).sandboxId).toBe("sbx_123");
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
          sandboxId: "sbx_123",
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
        sandboxId: "sbx_123",
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
          sandboxId: "sbx_123",
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
              sourceSandboxId: "sbx_123",
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
        sandboxId: "sbx_123",
        expiration: 0,
      });

      expect(mockFetch.mock.calls[0]?.[1]?.body).toBe(
        JSON.stringify({ expiration: 0 }),
      );
    });

  });
});
