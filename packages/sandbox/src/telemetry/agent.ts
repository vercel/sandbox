import { determineAgent } from "detect-agent";

let agentNamePromise: Promise<string | undefined> | undefined;

/**
 * Detects the AI agent driving this process, if any. Memoized because the
 * result is used both for telemetry events and for the user-agent header
 * on every API request.
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
