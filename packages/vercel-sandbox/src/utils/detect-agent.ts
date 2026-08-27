import { determineAgent } from "detect-agent";

let agentNamePromise: Promise<string | undefined> | undefined;

/**
 * Detects the AI agent driving this process, if any. Memoized so the
 * environment is inspected once per process, not once per request.
 */
export function detectAgentName(): Promise<string | undefined> {
  if (!agentNamePromise) {
    agentNamePromise = determineAgent().then(
      (result) => (result.isAgent ? result.agent.name : undefined),
      () => undefined,
    );
  }
  return agentNamePromise;
}
