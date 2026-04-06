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
          sandboxId: "sbx_123",
          exitCode: null,
          startedAt: 1,
        },
      };

      // Create a stream that sends the first chunk (command started)
      // but never sends the second chunk (command finished),
      // simulating a long-running command that gets aborted.
      const encoder = new TextEncoder();
      const firstChunk = JSON.stringify(commandData) + "\n";
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(firstChunk));
          // Never enqueue the finished chunk or close — simulates a
          // long-running command whose stream is still open.
        },
        cancel() {
          // Stream cancelled by abort signal
        },
      });

      mockFetch.mockResolvedValue(
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const controller = new AbortController();
      const result = await client.runCommand({
        sandboxId: "sbx_123",
        command: "python3",
        args: ["script.py"],
        env: {},
        sudo: false,
        wait: true,
        signal: controller.signal,
      });

      // First chunk parsed fine
      expect(result.command.id).toBe("cmd_123");

      // Abort the signal before the finished chunk arrives
      controller.abort();

      // The finished promise should reject with an abort-related error,
      // NOT a Zod validation error from parsing undefined, and NOT hang forever.
      const settled = await Promise.race([
        result.finished
          .then((v) => ({ status: "resolved" as const, value: v }))
          .catch((e) => ({ status: "rejected" as const, error: e })),
        new Promise<{ status: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ status: "timeout" }), 2000),
        ),
      ]);

      // Currently the promise hangs because abort doesn't propagate to the
      // jsonlines iterator — the finished promise never settles.
      expect(settled.status).not.toBe("timeout");

      // If it does settle, it should be a rejection, not a Zod error
      if (settled.status === "rejected") {
        expect(settled.error).not.toBeInstanceOf(z.ZodError);
      }
    }, 10000);

    it("throws Zod error when stream closes abruptly with no finished chunk", async () => {
      const commandData = {
        command: {
          id: "cmd_123",
          name: "python3",
          args: ["script.py"],
          cwd: "/",
          sandboxId: "sbx_123",
          exitCode: null,
          startedAt: 1,
        },
      };

      // Stream that sends the first chunk then immediately closes,
      // simulating a connection drop after the command starts.
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(JSON.stringify(commandData) + "\n"),
          );
          // Close immediately without sending the finished chunk
          controller.close();
        },
      });

      mockFetch.mockResolvedValue(
        new Response(stream, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      );

      const result = await client.runCommand({
        sandboxId: "sbx_123",
        command: "python3",
        args: ["script.py"],
        env: {},
        sudo: false,
        wait: true,
      });

      expect(result.command.id).toBe("cmd_123");

      // When the stream closes before sending the finished chunk,
      // iterator.next() returns { done: true, value: undefined },
      // and CommandFinishedResponse.parse(undefined) throws a ZodError.
      // This should be a more descriptive error instead.
      try {
        await result.finished;
        expect.fail("Expected an error from result.finished");
      } catch (err) {
        // Currently throws ZodError — this validates the bug exists
        expect(err).toBeInstanceOf(z.ZodError);
      }
    });
  });

  describe("stopSandbox", () => {
    let client: APIClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    const makeSandbox = (status: string) => ({
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
        new Response(JSON.stringify({ sandbox: makeSandbox("stopping") }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await client.stopSandbox({ sandboxId: "sbx_123" });

      expect(result.json.sandbox.status).toBe("stopping");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("polls until stopped when blocking is true", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ sandbox: makeSandbox("stopping") }), {
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ sandbox: makeSandbox("stopping"), routes: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ sandbox: makeSandbox("stopped"), routes: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        );

      const promise = client.stopSandbox({
        sandboxId: "sbx_123",
        blocking: true,
      });

      // Advance past the two polling delays
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result.json.sandbox.status).toBe("stopped");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("stops polling on failed status", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ sandbox: makeSandbox("stopping") }), {
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ sandbox: makeSandbox("failed"), routes: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        );

      const promise = client.stopSandbox({
        sandboxId: "sbx_123",
        blocking: true,
      });

      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result.json.sandbox.status).toBe("failed");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("stops polling on aborted status", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ sandbox: makeSandbox("stopping") }), {
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ sandbox: makeSandbox("aborted"), routes: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        );

      const promise = client.stopSandbox({
        sandboxId: "sbx_123",
        blocking: true,
      });

      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result.json.sandbox.status).toBe("aborted");
      expect(mockFetch).toHaveBeenCalledTimes(2);
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
