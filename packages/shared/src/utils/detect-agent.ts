import { determineAgent } from "@vercel/detect-agent";

let agentNamePromise: Promise<string | undefined> | undefined;

/**
 * Detects the AI agent driving this process, if any. Memoized so the
 * environment is inspected once per process, not once per request.
 * Attribution honors the telemetry opt-out variables: disabling telemetry
 * also stops the agent phrase from being added to the user-agent header.
 */
export function detectAgentName(
  telemetryDisabledEnv: string[],
): Promise<string | undefined> {
  if (
    process.env.VERCEL_TELEMETRY_DISABLED ||
    telemetryDisabledEnv.some((name) => process.env[name])
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
