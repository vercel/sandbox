import type { Sandbox } from "@vercel/sandbox";
import { posix } from "node:path";
import { parse, stringify } from "smol-toml";
import { agentNames } from "../../commands/agents";
import {
  gatewayEnv,
  gatewayHost,
  placeholder,
  type AgentName,
  type AgentSelection,
} from "./policy";

export const defaultModel = "openai/gpt-5.4-mini";
export const claudeModel = "anthropic/claude-sonnet-4.6";

type Config = Record<string, unknown>;
function object(value: unknown): Config {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object in agent configuration.");
  return value as Config;
}

export function agentFiles(agent: AgentName): string[] {
  switch (agent) {
    case "codex":
      return ["/vercel/.codex/config.toml"];
    case "claude":
      return ["/vercel/.claude/settings.json"];
    case "opencode":
      return ["/vercel/.config/opencode/opencode.json"];
    case "pi":
      return ["/vercel/.pi/agent/auth.json", "/vercel/.pi/agent/settings.json"];
  }
}

export function configureFile(
  agent: AgentName,
  path: string,
  previous: string | null,
): string {
  const data: Config = previous
    ? object(path.endsWith(".toml") ? parse(previous) : JSON.parse(previous))
    : {};
  switch (agent) {
    case "codex": {
      const providers = object(data.model_providers);
      data.model_providers = {
        ...providers,
        vercel: {
          ...object(providers.vercel),
          name: "Vercel AI Gateway",
          base_url: `https://${gatewayHost}/codex/v1`,
          env_key: "AI_GATEWAY_API_KEY",
          wire_api: "responses",
          supports_websockets: false,
        },
      };
      data.model_provider = "vercel";
      data.model ??= defaultModel;
      return stringify(data);
    }
    case "claude": {
      const env = object(data.env);
      data.env = {
        ...env,
        ...gatewayEnv(agent),
        ANTHROPIC_MODEL: env.ANTHROPIC_MODEL ?? claudeModel,
      };
      break;
    }
    case "opencode": {
      const providers = object(data.provider);
      const vercel = object(providers.vercel);
      data.provider = {
        ...providers,
        vercel: {
          ...vercel,
          options: { ...object(vercel.options), apiKey: placeholder },
        },
      };
      data.model ??= `vercel/${defaultModel}`;
      break;
    }
    case "pi":
      if (path.endsWith("auth.json"))
        data["vercel-ai-gateway"] = { type: "api_key", key: placeholder };
      else {
        data.defaultProvider = "vercel-ai-gateway";
        data.defaultModel ??= defaultModel;
      }
  }
  return JSON.stringify(data, null, 2) + "\n";
}

export async function prepareAgent(
  sandbox: Sandbox,
  selection: AgentSelection,
) {
  const writes = [];
  for (const agent of selection === "all" ? agentNames : [selection]) {
    for (const path of agentFiles(agent)) {
      const previous = await sandbox.readFileToBuffer({ path });
      let content: string;
      try {
        content = configureFile(
          agent,
          path,
          previous?.toString("utf8") ?? null,
        );
      } catch {
        throw new Error(
          `Cannot parse ${path}; existing agent configuration was not replaced.`,
        );
      }
      if (content !== previous?.toString("utf8"))
        writes.push({ path, content: Buffer.from(content) });
    }
  }
  for (const directory of new Set(
    writes.map(({ path }) => posix.dirname(path)),
  ))
    await sandbox.fs.mkdir(directory, { recursive: true });
  if (writes.length) await sandbox.writeFiles(writes);
}
