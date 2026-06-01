import { Sandbox, APIError, Snapshot } from "@vercel/sandbox";
import { version } from "./pkg";
import chalk from "chalk";
import { tmpdir } from "node:os";
import Path from "node:path";
import { writeFile } from "node:fs/promises";
import { StyledError } from "./error";
import { withFreshAuthRetry } from "./util/fresh-auth-retry";
import { z } from "zod";

/**
 * A {@link Sandbox} wrapper that adds user-agent headers and error handling.
 */
export const sandboxClient: Pick<
  typeof Sandbox,
  "get" | "list" | "create" | "fork"
> = {
  get: (params) =>
    withErrorHandling(() =>
      Sandbox.get({ fetch: fetchWithUserAgent, resume: false, ...params }),
    ),
  create: (params) =>
    withErrorHandling(() =>
      Sandbox.create({ fetch: fetchWithUserAgent, ...params }),
    ),
  fork: (params) =>
    withErrorHandling(() =>
      Sandbox.fork({ fetch: fetchWithUserAgent, ...params }),
    ),
  list: (params) =>
    withErrorHandling(() =>
      Sandbox.list({ fetch: fetchWithUserAgent, ...params } as typeof params),
    ),
};

export const snapshotClient: Pick<
  typeof Snapshot,
  "get" | "list" | "tree"
> = {
  list: (params) =>
    withErrorHandling(() =>
      Snapshot.list({ fetch: fetchWithUserAgent, ...params }),
    ),
  get: (params) => withErrorHandling(() => Snapshot.get({ ...params })),
  tree: (params) =>
    withErrorHandling(() => Snapshot.tree({ fetch: fetchWithUserAgent, ...params })),
};

const fetchWithUserAgent: typeof globalThis.fetch = (input, init) => {
  const headers = new Headers(
    init?.headers ??
      (input && typeof input === "object" && "headers" in input
        ? input?.headers
        : {}),
  );
  let agent = `vercel/sandbox-cli/${version}`;

  const existingAgent = headers.get("user-agent");
  if (existingAgent) {
    agent += ` ${existingAgent}`;
  }

  headers.set("user-agent", agent);

  return fetch(input, { ...init, headers });
};

/**
 * Runs an SDK operation and rethrows any {@link APIError} as a friendly
 * {@link StyledError}. Wrap SDK instance methods (e.g. `sandbox.stop()`) with
 * this in commands that render errors themselves and skip `sandbox.ts`.
 */
export async function withErrorHandling<T>(
  factory: () => Promise<T>,
): Promise<T> {
  try {
    return await withFreshAuthRetry(factory);
  } catch (error) {
    if (error instanceof APIError) {
      throw await toFriendlyApiError(error);
    }
    throw error;
  }
}

/** Sandbox API error response shape (`@api/with-api-errors`). */
const ApiErrorResponse = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string(),
  }),
});

/**
 * Converts an {@link APIError} into a {@link StyledError} safe to show users.
 * Known errors surface the API's message; internal/unparseable ones get a
 * generic message and the full response is saved to a temp file for debugging.
 */
export async function toFriendlyApiError(
  error: APIError<unknown>,
): Promise<StyledError> {
  const status = error.response.status;
  const parsed = ApiErrorResponse.safeParse(error.json);
  const code = parsed.success ? parsed.data.error.code : undefined;
  const apiMessage = parsed.success ? parsed.data.error.message : undefined;

  if (apiMessage && !isInternalApiError(status, code)) {
    const lines = [apiMessage];
    if (status === 401 || status === 403) {
      lines.push(
        `╰▶ ${chalk.bold("hint:")} check your token or run \`sandbox login\`.`,
      );
    } else {
      lines.push(
        chalk.dim(`╰▶ status code: ${status} ${error.response.statusText}`),
      );
    }
    return new StyledError(lines.join("\n"), error);
  }

  // Internal/unexpected: hide details, persist the raw response for debugging.
  const tmpPath = await writeResponseToTemp(error);
  const lines = [
    getErrorMessage(status),
    `├▶ requested url: ${error.response.url}`,
    `├▶ status code: ${status} ${error.response.statusText}`,
    `╰▶ ${chalk.bold("hint:")} the full response buffer is stored in ${chalk.italic(tmpPath)}`,
  ];
  return new StyledError(lines.join("\n"), error);
}

/** Internal errors never carry a user-facing message. */
function isInternalApiError(status: number, code?: string): boolean {
  return status >= 500 || code === "internal_server_error";
}

function getErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Sandbox API request failed due to authentication. Check your token or run `sandbox login`.";
  }
  if (status === 404) {
    return "Sandbox API request failed: resource not found.";
  }
  if (status >= 500) {
    return "Sandbox API responded with a server error. Please try again.";
  }
  return "Sandbox API request failed.";
}

async function writeResponseToTemp({
  response,
  text,
}: APIError<unknown>): Promise<string> {
  const unique = [process.pid, process.hrtime.bigint()]
    .map((x) => x.toString(36))
    .join("");
  const tmpPath = Path.join(tmpdir(), `sandbox-cli-response-${unique}.http`);
  const buffers = [] as Buffer[];
  buffers.push(Buffer.from(`${response.url}\r\n`));
  buffers.push(Buffer.from(`${response.status} ${response.statusText}\r\n`));
  for (const [key, value] of response.headers) {
    buffers.push(Buffer.from(`${key}: ${value}\r\n`));
  }
  buffers.push(Buffer.from(`\r\n`));
  if (text) {
    buffers.push(Buffer.from(text));
  }
  await writeFile(tmpPath, Buffer.concat(buffers));
  return tmpPath;
}
