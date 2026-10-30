import { detectAgentName } from "../telemetry/agent";

export interface ExecutionMode {
  json: boolean;
  interactive: boolean;
}

export async function resolveExecutionMode(options: {
  json: boolean;
  nonInteractive?: boolean;
  payloadStdin: boolean;
}): Promise<ExecutionMode> {
  const forced =
    options.json ||
    options.payloadStdin ||
    Boolean(process.env.CI) ||
    !process.stdin.isTTY ||
    !process.stderr.isTTY;
  const agent = await detectAgentName();
  return {
    json: options.json,
    interactive:
      !forced &&
      options.nonInteractive !== true &&
      (!agent || options.nonInteractive === false),
  };
}
