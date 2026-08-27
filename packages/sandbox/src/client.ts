import { Sandbox, APIError, Snapshot } from "@vercel/sandbox";
import { version } from "./pkg";
import { withFreshAuthRetry } from "./util/fresh-auth-retry";
import { formatApiError } from "./util/format-error";
import { telemetry } from "./telemetry";
import { detectAgentName } from "./telemetry/agent";

/**
 * A {@link Sandbox} wrapper that adds user-agent headers and error handling.
 */
export const sandboxClient: Pick<
  typeof Sandbox,
  "get" | "list" | "create" | "fork"
> = {
  get: (params) =>
    withErrorHandling(() => {
      telemetry.updateTeamId(teamIdOf(params));
      return Sandbox.get({ fetch: fetchWithUserAgent, resume: false, ...params });
    }),
  create: (params) =>
    withErrorHandling(() => {
      telemetry.updateTeamId(teamIdOf(params));
      return Sandbox.create({ fetch: fetchWithUserAgent, ...params });
    }),
  fork: (params) =>
    withErrorHandling(() => {
      telemetry.updateTeamId(teamIdOf(params));
      return Sandbox.fork({ fetch: fetchWithUserAgent, ...params });
    }),
  list: (params) =>
    withErrorHandling(() => {
      telemetry.updateTeamId(teamIdOf(params));
      return Sandbox.list({ fetch: fetchWithUserAgent, ...params } as typeof params);
    }),
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

function teamIdOf(params: unknown): string | undefined {
  if (params && typeof params === "object" && "teamId" in params) {
    const { teamId } = params as { teamId?: unknown };
    if (typeof teamId === "string") return teamId;
  }
  return undefined;
}

const fetchWithUserAgent: typeof globalThis.fetch = async (input, init) => {
  const headers = new Headers(
    init?.headers ??
      (input && typeof input === "object" && "headers" in input
        ? input?.headers
        : {}),
  );
  let agent = `vercel/sandbox-cli/${version}`;

  // Attribute API traffic to the AI agent driving this invocation, if any,
  // so the server side can record it once ingestion support lands.
  const aiAgent = await detectAgentName();
  if (aiAgent) {
    agent += ` agent/${aiAgent}`;
  }

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
