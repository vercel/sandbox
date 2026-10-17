import type { NetworkPolicy, NetworkPolicyRule } from "@vercel/sandbox";
import { agentNames } from "../../commands/agents";

export const gatewayHost = "ai-gateway.vercel.sh";
export const gatewayTag = "sandbox-ai";
export const placeholder = "sandbox-firewall-credential";
export type AgentName = (typeof agentNames)[number];
export type AgentSelection = AgentName | "all";
export type GatewaySelection = AgentSelection | "none";

export function gatewayAgent(
  tags?: Record<string, string>,
): GatewaySelection | undefined {
  const value = tags?.[gatewayTag];
  if (value === undefined) return;
  const [version, selected, fingerprint, extra] = value.split(":");
  const agent =
    version === "v3" && fingerprint === "managed" && !extra
      ? selected === "all" || selected === "none"
        ? selected
        : agentNames.find((name) => name === selected)
      : undefined;
  if (!agent)
    throw new Error(
      "Unsupported sandbox-ai configuration. Update the Sandbox CLI or create a new sandbox with --ai.",
    );
  return agent;
}

export function gatewayTags(
  tags: Record<string, string>,
  agent: GatewaySelection,
) {
  if (gatewayTag in tags || Object.keys(tags).length >= 5) {
    throw new Error(
      "--ai needs one available tag slot; sandbox-ai is reserved for Gateway setup.",
    );
  }
  return {
    ...tags,
    [gatewayTag]: `v3:${agent}:managed`,
  };
}

export function gatewayPolicy(
  policy: NetworkPolicy,
  key: string,
): NetworkPolicy {
  if (policy === "deny-all")
    throw new Error("--ai cannot use a deny-all network policy.");
  const base: Exclude<NetworkPolicy, string> =
    policy === "allow-all" ? { allow: { "*": [] } } : policy;
  if (base.subnets?.allow?.length) {
    throw new Error(
      "Gateway credential injection cannot be combined with allowed CIDRs, which bypass domain rules.",
    );
  }
  const allow: Record<string, NetworkPolicyRule[]> = Array.isArray(base.allow)
    ? Object.fromEntries(base.allow.map((domain) => [domain, []]))
    : { ...base.allow };
  const rules = allow[gatewayHost];
  if (policy !== "allow-all" && !rules && !("*" in allow)) {
    throw new Error(
      `The network policy must explicitly allow ${gatewayHost} to use --ai.`,
    );
  }
  for (const [domain, entries] of Object.entries(allow)) {
    if (domain !== gatewayHost && entries.length > 0) {
      throw new Error(
        "Cannot combine automatic Gateway setup with other firewall request rules. Their credentials cannot be safely restored from policy readback.",
      );
    }
  }
  if (rules?.length) {
    throw new Error(
      "The Gateway domain already has custom firewall rules. Automatic setup will not replace them.",
    );
  }
  return {
    ...base,
    allow: {
      ...allow,
      [gatewayHost]: [
        {
          transform: [
            { headers: { authorization: `Bearer ${key}`, host: gatewayHost } },
          ],
        },
      ],
    },
  };
}

const managedEnv = new Set([
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "PI_CODING_AGENT_DIR",
  "OPENCODE_CONFIG",
  "XDG_CONFIG_HOME",
  "HOME",
]);

export function checkGatewayEnv(
  env: Record<string, string>,
  selection: GatewaySelection = "all",
) {
  const conflicting = Object.keys(env).filter((key) =>
    selection === "none" ? key === "AI_GATEWAY_API_KEY" : managedEnv.has(key),
  );
  if (conflicting.length)
    throw new Error(
      `--ai manages these environment variables; remove their --env overrides: ${conflicting.join(", ")}`,
    );
}

export function gatewayEnv(agent: GatewaySelection): Record<string, string> {
  return {
    AI_GATEWAY_API_KEY: placeholder,
    ...(agent === "claude" || agent === "all"
      ? {
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_AUTH_TOKEN: placeholder,
          ANTHROPIC_BASE_URL: `https://${gatewayHost}/claude-code`,
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
        }
      : {}),
  };
}
