import { Sandbox, APIError, Snapshot, Drive } from "@vercel/sandbox";
import { version } from "./pkg";
import { withFreshAuthRetry } from "./util/fresh-auth-retry";
import { formatApiError } from "./util/format-error";

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

export const driveClient: Pick<typeof Drive, "getOrCreate" | "list"> & {
  delete(drive: Drive): Promise<void>;
} = {
  getOrCreate: (params) =>
    withErrorHandling(() =>
      Drive.getOrCreate({ fetch: fetchWithUserAgent, ...params }),
    ),
  list: (params) =>
    withErrorHandling(() =>
      Drive.list({ fetch: fetchWithUserAgent, ...params } as typeof params),
    ),
  delete: (drive) => withErrorHandling(() => drive.delete()),
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

async function withErrorHandling<T>(factory: () => Promise<T>): Promise<T> {
  try {
    return await withFreshAuthRetry(factory);
  } catch (error) {
    if (error instanceof APIError) {
      throw await formatApiError(error);
    }
    throw error;
  }
}
