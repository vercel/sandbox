import { Sandbox, APIError, Snapshot } from "@vercel/sandbox";
import { version } from "./pkg";
import { withFreshAuthRetry } from "./util/fresh-auth-retry";
import { formatApiError } from "./util/format-error";
import { traced } from "./otel";

const wrapped = {
  Sandbox: {
    get: traced({ name: "Sandbox.get" }, Sandbox.get),
    create: traced({ name: "Sandbox.create" }, Sandbox.create),
    fork: traced({ name: "Sandbox.fork" }, Sandbox.fork),
    list: traced({ name: "Sandbox.list" }, Sandbox.list),
  },
  Snapshot: {
    list: traced({ name: "Snapshot.list" }, Snapshot.list),
    get: traced({ name: "Snapshot.get" }, Snapshot.get),
    tree: traced({ name: "Snapshot.tree" }, Snapshot.tree),
  },
};

/**
 * A {@link Sandbox} wrapper that adds user-agent headers and error handling.
 */
export const sandboxClient: Pick<
  typeof Sandbox,
  "get" | "list" | "create" | "fork"
> = {
  get: (params) =>
    withErrorHandling(() =>
      wrapped.Sandbox.get({
        fetch: fetchWithUserAgent,
        resume: false,
        ...params,
      }),
    ),
  create: (params) =>
    withErrorHandling(() =>
      wrapped.Sandbox.create({ fetch: fetchWithUserAgent, ...params }),
    ),
  fork: (params) =>
    withErrorHandling(() =>
      wrapped.Sandbox.fork({ fetch: fetchWithUserAgent, ...params }),
    ),
  list: (params) =>
    withErrorHandling(() =>
      wrapped.Sandbox.list({
        fetch: fetchWithUserAgent,
        ...params,
      } as typeof params),
    ),
};

export const snapshotClient: Pick<typeof Snapshot, "get" | "list" | "tree"> = {
  list: (params) =>
    withErrorHandling(() =>
      wrapped.Snapshot.list({ fetch: fetchWithUserAgent, ...params }),
    ),
  get: (params) => withErrorHandling(() => wrapped.Snapshot.get({ ...params })),
  tree: (params) =>
    withErrorHandling(() =>
      wrapped.Snapshot.tree({ fetch: fetchWithUserAgent, ...params }),
    ),
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
