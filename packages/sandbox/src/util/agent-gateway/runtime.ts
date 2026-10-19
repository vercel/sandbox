import type { Sandbox } from "@vercel/sandbox";
import { prepareAgent } from "./config";
import { gatewayAgent, type GatewaySelection } from "./policy";

const prepared = new WeakMap<Sandbox, Set<GatewaySelection>>();
export function rememberGatewaySetup(
  sandbox: Sandbox,
  agent: GatewaySelection,
) {
  const agents = prepared.get(sandbox) ?? new Set<GatewaySelection>();
  agents.add(agent);
  prepared.set(sandbox, agents);
}

export async function validateGatewayCredentials(sandbox: Sandbox) {
  if (prepared.has(sandbox)) return;
  if (!gatewayAgent(sandbox.tags))
    throw new Error("Gateway sandbox metadata is missing.");
}

export async function refreshGateway(
  sandbox: Sandbox,
  agent: GatewaySelection,
) {
  if (agent === "none") return;
  const agents = prepared.get(sandbox);
  if (agents?.has("all") || agents?.has(agent)) return;
  await prepareAgent(sandbox, agent);
  rememberGatewaySetup(sandbox, agent);
}
