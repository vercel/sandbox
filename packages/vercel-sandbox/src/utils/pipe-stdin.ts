import { Writable, type Readable } from "stream";
import { APIError } from "../api-client/api-error.js";

/**
 * Reading pauses once this much is buffered behind an in-flight write.
 */
const MAX_BUFFERED_BYTES = 512 * 1024;

export interface StdinTarget {
  writeStdin(data: Uint8Array): Promise<void>;
  closeStdin(): Promise<void>;
}

export interface StdinPipe {
  /**
   * Resolves once the stream has ended and stdin is closed, or once the
   * command stops accepting input. Rejects if a write fails or the stream
   * errors.
   */
  done: Promise<void>;
  /**
   * Stops reading the stream, for when the command has exited.
   */
  stop(): void;
}

/**
 * Writes a stream to a command's stdin in order, and closes stdin when the
 * stream ends. Data read while a write is in flight is sent together as soon
 * as that write resolves. The stream is never ended or destroyed, and all
 * listeners are removed once piping stops so the stream can't keep the
 * process alive.
 */
export function pipeStdin(
  target: StdinTarget,
  stream: Readable,
  signal?: AbortSignal,
): StdinPipe {
  let stopped = false;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;

  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});

  const writable = new Writable({
    highWaterMark: MAX_BUFFERED_BYTES,
    writev(chunks, callback) {
      target
        .writeStdin(Buffer.concat(chunks.map(({ chunk }) => chunk)))
        .then(() => callback(), callback);
    },
    final(callback) {
      target.closeStdin().then(() => callback(), callback);
    },
  });

  const stop = () => {
    if (stopped) return false;
    stopped = true;
    stream.unpipe(writable);
    stream.off("error", onError);
    stream.off("close", onClose);
    signal?.removeEventListener("abort", onAbort);
    stream.pause();
    writable.destroy();
    return true;
  };

  const settle = (error?: unknown) => {
    if (!stop()) return;
    if (error === undefined) resolveDone();
    else rejectDone(error);
  };

  const onError = (error: unknown) => {
    if (!stop()) return;
    target
      .closeStdin()
      .catch(() => {})
      .finally(() => rejectDone(error));
  };

  const onClose = () => {
    if (!stream.readableEnded) {
      onError(new Error("The stdin stream closed before it ended"));
    }
  };

  const onAbort = () => settle();

  writable.on("finish", () => settle());
  writable.on("error", (error) =>
    settle(isInputNoLongerAccepted(error) ? undefined : error),
  );

  if (signal?.aborted) {
    settle();
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
    stream.on("error", onError);
    stream.on("close", onClose);
    if (stream.destroyed && !stream.readableEnded) onClose();
    else stream.pipe(writable);
  }

  return { done, stop: () => settle() };
}

/**
 * Waits for a command to finish, rejecting early if piping stdin fails, and
 * stops piping once the command has exited. Aborting `signal` stops waiting
 * but leaves the pipe running. `onPipeError` is called when the rejection
 * comes from the pipe.
 */
export async function waitWithStdinPipe<T>(
  finished: Promise<T>,
  pipe: StdinPipe | null,
  opts?: { signal?: AbortSignal; onPipeError?: () => void },
): Promise<T> {
  if (!pipe) return finished;
  finished.then(
    () => pipe.stop(),
    () => {
      if (!opts?.signal?.aborted) pipe.stop();
    },
  );
  return Promise.race([
    finished,
    pipe.done.then(
      () => finished,
      (error) => {
        opts?.onPipeError?.();
        throw error;
      },
    ),
  ]);
}

/**
 * Whether a write failed because the command exited or stopped reading
 * stdin, which ends piping the same way a closed pipe does in a shell.
 */
function isInputNoLongerAccepted(error: unknown) {
  if (!(error instanceof APIError)) return false;
  const code = (error.json as { error?: { code?: string } } | undefined)?.error
    ?.code;
  return (
    error.response.status === 404 ||
    (error.response.status === 400 && code === "command_stdin_unavailable")
  );
}
