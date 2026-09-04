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
    withErrorHandling(async () => {
      updateScope(params);
      const sandbox = await Sandbox.get({ fetch: fetchWithUserAgent, resume: false, ...params });
      trackSession(sandbox, "attached");
      return sandbox;
    }),
  create: (params) =>
    withErrorHandling(async () => {
      updateScope(params);
      const sandbox = await Sandbox.create({ fetch: fetchWithUserAgent, ...params });
      trackSession(sandbox, "created");
      return sandbox;
    }),
  fork: (params) =>
    withErrorHandling(async () => {
      updateScope(params);
      const sandbox = await Sandbox.fork({ fetch: fetchWithUserAgent, ...params });
      trackSession(sandbox, "created");
      return sandbox;
    }),
  list: (params) =>
    withErrorHandling(() => {
      updateScope(params);
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

function scopeField(params: unknown, field: string): string | undefined {
  if (params && typeof params === "object" && field in params) {
    const value = (params as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function updateScope(params: unknown): void {
  telemetry.updateTeamId(scopeField(params, "teamId"));
  telemetry.updateProjectId(scopeField(params, "projectId"));
}

function trackSession(sandbox: Sandbox, origin: "created" | "attached"): void {
  try {
    telemetry.trackSandboxSession(sandbox.currentSession().sessionId, origin);
  } catch {
    // No active session on this instance; nothing to record.
  }
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
  // so the server side can record it once ingestion support lands. Gated on
  // the telemetry setting so opting out covers agent attribution too.
  if (telemetry.enabled) {
    const aiAgent = await detectAgentName();
    if (aiAgent) {
      agent += ` agent/${aiAgent}`;
    }
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
