import { determineAgent } from "@vercel/detect-agent";

let agentNamePromise: Promise<string | undefined> | undefined;

/**
 * Detects the AI agent driving this process, if any. Memoized so the
 * environment is inspected once per process, not once per request.
 * Attribution honors the telemetry opt-out variables: disabling telemetry
 * also stops the agent phrase from being added to the user-agent header.
 */
export function detectAgentName(): Promise<string | undefined> {
  if (
    process.env.VERCEL_TELEMETRY_DISABLED ||
    process.env.VERCEL_SANDBOX_TELEMETRY_DISABLED
  ) {
    return Promise.resolve(undefined);
  }
  if (!agentNamePromise) {
    agentNamePromise = determineAgent().then(
      (result) => (result.isAgent ? result.agent.name : undefined),
      () => undefined,
    );
  }
  return agentNamePromise;
}
