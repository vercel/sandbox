import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "stream";
import { APIError } from "../api-client/api-error.js";
import { pipeStdin, waitWithStdinPipe, type StdinTarget } from "./pipe-stdin.js";

function createTarget() {
  const writes: string[] = [];
  const calls: string[] = [];
  const target = {
    writes,
    calls,
    writeStdin: vi.fn(async (data: Uint8Array) => {
      writes.push(Buffer.from(data).toString());
      calls.push("write");
    }),
    closeStdin: vi.fn(async () => {
      calls.push("close");
    }),
  } satisfies StdinTarget & Record<string, unknown>;
  return target;
}

function apiError(status: number, code: string) {
  return new APIError(new Response(null, { status }), {
    json: { error: { code } },
  });
}

const listenerCount = (stream: PassThrough) =>
  stream.listenerCount("data") +
  stream.listenerCount("end") +
  stream.listenerCount("error");

describe("pipeStdin", () => {
  it("writes the stream in order and closes stdin when it ends", async () => {
    const target = createTarget();
    const stream = new PassThrough({ autoDestroy: false });

    const pipe = pipeStdin(target, stream);
    stream.write("a");
    await vi.waitFor(() => expect(target.writes).toEqual(["a"]));
    stream.end("b");
    await pipe.done;

    expect(target.writes.join("")).toBe("ab");
    expect(target.calls.at(-1)).toBe("close");
    expect(stream.destroyed).toBe(false);
    expect(listenerCount(stream)).toBe(0);
  });

  it("sends data read during a write together once it resolves", async () => {
    const target = createTarget();
    let release!: () => void;
    target.writeStdin.mockImplementationOnce(async (data) => {
      target.writes.push(Buffer.from(data).toString());
      await new Promise<void>((resolve) => (release = resolve));
    });
    const stream = new PassThrough();

    const pipe = pipeStdin(target, stream);
    stream.write("a");
    await vi.waitFor(() => expect(target.writes).toEqual(["a"]));
    stream.write("b");
    stream.end("c");
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await pipe.done;

    expect(target.writes).toEqual(["a", "bc"]);
  });

  it("pauses reading while too much is buffered behind a write", async () => {
    const target = createTarget();
    let release!: () => void;
    target.writeStdin.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const stream = new PassThrough({ highWaterMark: 1 });

    const pipe = pipeStdin(target, stream);
    stream.write("a");
    await vi.waitFor(() => expect(target.writeStdin).toHaveBeenCalledTimes(1));
    stream.write(Buffer.alloc(512 * 1024));
    await vi.waitFor(() => expect(stream.isPaused()).toBe(true));

    release();
    await vi.waitFor(() => expect(target.writeStdin).toHaveBeenCalledTimes(2));
    expect(stream.isPaused()).toBe(false);
    pipe.stop();
  });

  it.each([
    ["the command exited", apiError(404, "command_not_found_or_exited")],
    ["the command stopped reading", apiError(400, "command_stdin_unavailable")],
  ])("stops quietly when %s", async (_, error) => {
    const target = createTarget();
    target.writeStdin.mockRejectedValueOnce(error);
    const stream = new PassThrough();

    const pipe = pipeStdin(target, stream);
    stream.write("a");
    await pipe.done;

    expect(target.closeStdin).not.toHaveBeenCalled();
    expect(listenerCount(stream)).toBe(0);
    expect(stream.isPaused()).toBe(true);
  });

  it("rejects and stops reading when a write fails", async () => {
    const target = createTarget();
    const error = apiError(500, "internal");
    target.writeStdin.mockRejectedValueOnce(error);
    const stream = new PassThrough();

    const pipe = pipeStdin(target, stream);
    stream.write("a");

    await expect(pipe.done).rejects.toBe(error);
    expect(listenerCount(stream)).toBe(0);
  });

  it("closes stdin and rejects when the stream errors", async () => {
    const target = createTarget();
    const stream = new PassThrough();
    const error = new Error("boom");
    stream.on("error", () => {});

    const pipe = pipeStdin(target, stream);
    stream.emit("error", error);

    await expect(pipe.done).rejects.toBe(error);
    expect(target.closeStdin).toHaveBeenCalledTimes(1);
  });

  it("closes stdin right away for a stream that already ended", async () => {
    const target = createTarget();
    const stream = new PassThrough();
    stream.end();
    stream.resume();
    await new Promise((resolve) => stream.once("end", resolve));

    await pipeStdin(target, stream).done;

    expect(target.calls).toEqual(["close"]);
  });

  it("stops reading when stopped or aborted", async () => {
    const target = createTarget();
    const stream = new PassThrough();
    const controller = new AbortController();

    const pipe = pipeStdin(target, stream, controller.signal);
    controller.abort();
    await pipe.done;
    stream.write("a");

    expect(target.writeStdin).not.toHaveBeenCalled();
    expect(listenerCount(stream)).toBe(0);
  });
});

describe("waitWithStdinPipe", () => {
  it("resolves with the result and stops piping once the command exits", async () => {
    const target = createTarget();
    const stream = new PassThrough();
    const pipe = pipeStdin(target, stream);

    await expect(waitWithStdinPipe(Promise.resolve(7), pipe)).resolves.toBe(7);
    expect(listenerCount(stream)).toBe(0);
  });

  it("rejects without waiting for the command when piping fails", async () => {
    const target = createTarget();
    const error = apiError(500, "internal");
    target.writeStdin.mockRejectedValueOnce(error);
    const stream = new PassThrough();
    const pipe = pipeStdin(target, stream);
    stream.write("a");

    await expect(
      waitWithStdinPipe(new Promise<number>(() => {}), pipe),
    ).rejects.toBe(error);
  });
});
