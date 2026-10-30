import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { CliError } from "./cli-error";
import { MAX_PAYLOAD_BYTES } from "./managed-credentials-config";

const STDIN_TIMEOUT_MS = 30_000;

/**
 * Read a bounded UTF-8 JSON payload from a file or stdin.
 *
 * Enforces size, encoding, and file-type limits for configuration inputs.
 * Diagnostics never include the payload: a configuration
 * file should hold no secrets, but an accidental one must not reach a log.
 */
export async function readJsonPayload(
  path: string,
  flag: string,
): Promise<unknown> {
  const content =
    path === "-" ? await readStdin(flag) : await readFile(path, flag);
  try {
    return JSON.parse(content);
  } catch {
    throw new CliError(
      `${flag} must contain valid UTF-8 JSON. Check the input file's JSON syntax.`,
    );
  }
}

async function readFile(path: string, flag: string): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK,
  ).catch(() => {
    throw new CliError(
      `Can't read ${flag}. Check that the path names a readable JSON file.`,
    );
  });
  try {
    if (!(await handle.stat()).isFile()) {
      throw new CliError(`${flag} must name a regular JSON file.`);
    }
    const buffer = Buffer.alloc(MAX_PAYLOAD_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_PAYLOAD_BYTES) {
      throw new CliError(`${flag} must not exceed 64 KiB.`);
    }
    return decode(buffer.subarray(0, size), flag);
  } finally {
    await handle.close();
  }
}

function decode(buffer: Buffer, flag: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new CliError(`${flag} must contain valid UTF-8 JSON.`);
  }
}

async function readStdin(flag: string): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CliError(
      `${flag} - requires piped JSON input. Redirect a JSON file to stdin or pass its path with ${flag}.`,
    );
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.pause();
      if (error) return reject(error);
      try {
        resolve(decode(Buffer.concat(chunks), flag));
      } catch (cause) {
        reject(cause);
      }
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_PAYLOAD_BYTES) {
        finish(new CliError(`${flag} must not exceed 64 KiB.`));
      } else {
        chunks.push(buffer);
      }
    };
    const onEnd = () => finish();
    const onError = () => finish(new CliError("Can't read JSON from stdin."));
    const timer = setTimeout(
      () =>
        finish(
          new CliError(
            `Timed out reading ${flag} - after 30s. Finish the JSON input and close stdin.`,
          ),
        ),
      STDIN_TIMEOUT_MS,
    );
    process.stdin.on("data", onData).once("end", onEnd).once("error", onError);
    process.stdin.resume();
  });
}
