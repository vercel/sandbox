import { Sandbox, APIError, Snapshot } from "@vercel/sandbox";
import { version } from "./pkg";
import chalk from "chalk";
import { tmpdir } from "node:os";
import Path from "node:path";
import { writeFile } from "node:fs/promises";
import { StyledError } from "./error";
import { z } from "zod";

/**
 * A {@link Sandbox} wrapper that adds user-agent headers and error handling.
 */
export const sandboxClient: Pick<typeof Sandbox, "get" | "list" | "create"> = {
  get: (params) =>
    withErrorHandling(Sandbox.get({ fetch: fetchWithUserAgent, ...params })),
  create: (params) =>
    withErrorHandling(Sandbox.create({ fetch: fetchWithUserAgent, ...params })),
  list: (params) =>
    withErrorHandling(
      Sandbox.list({ fetch: fetchWithUserAgent, ...params } as typeof params),
    ),
};

export const snapshotClient: Pick<typeof Snapshot, "get" | "list"> = {
  list: (params) =>
    withErrorHandling(Snapshot.list({ fetch: fetchWithUserAgent, ...params })),
  get: (params) => withErrorHandling(Snapshot.get({ ...params })),
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

async function withErrorHandling<T>(promise: Promise<T>) {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof APIError) {
      return await handleApiError(error);
    }
    throw error;
  }
}

async function handleApiError(error: APIError<unknown>): Promise<never> {
  const tmpPath = await writeResponseToTemp(error);
  const status = error.response.status;
  const parsedError = ApiErrorResponse.safeParse(error.json);
  const message = parsedError.data?.error.message ?? getErrorMessage(status);
  const lines = [
    message,
    `├▶ requested url: ${error.response.url}`,
    `├▶ status code: ${status} ${error.response.statusText}`,
    `╰▶ ${chalk.bold("hint:")} the full response buffer is stored in ${chalk.italic(tmpPath)}`,
  ];
  throw new StyledError(lines.join("\n"), error);
}

const ApiErrorResponse = z.object({
  error: z.object({
    message: z.string(),
  }),
});

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
