import { detectAgentName } from "../telemetry/agent";

export async function isInteractive(options: {
  nonInteractive?: boolean;
  payloadStdin: boolean;
}): Promise<boolean> {
  const forced =
    options.payloadStdin ||
    Boolean(process.env.CI) ||
    !process.stdin.isTTY ||
    !process.stderr.isTTY;
  const agent = await detectAgentName();
  return (
    !forced &&
    options.nonInteractive !== true &&
    (!agent || options.nonInteractive === false)
  );
}
