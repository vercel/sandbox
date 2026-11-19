import { detectAgentName } from "../telemetry/agent";

/**
 * Whether a person is at the terminal to answer a question. CI, a detected
 * AI agent, and a redirected stdin or stderr all mean nobody is, and a prompt
 * there would hang the command.
 */
export async function isInteractive(): Promise<boolean> {
  if (process.env.CI || !process.stdin.isTTY || !process.stderr.isTTY) {
    return false;
  }
  return (await detectAgentName()) === undefined;
}
