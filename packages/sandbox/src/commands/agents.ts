export const agentNames = ["opencode", "pi"] as const;

type Agent = {
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  reconnectArgs: string[];
  reconnectEnv: "defaults" | "explicit";
};

export const agents: Record<(typeof agentNames)[number], Agent> = {
  opencode: {
    displayName: "OpenCode",
    command: "opencode",
    args: [],
    env: { OPENCODE_DISABLE_AUTOUPDATE: "true" },
    reconnectArgs: ["--continue"],
    reconnectEnv: "defaults",
  },
  pi: {
    displayName: "Pi",
    command: "pi",
    args: [],
    env: {},
    reconnectArgs: ["--continue"],
    reconnectEnv: "explicit",
  },
};
