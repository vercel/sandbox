export const agentNames = ["opencode", "claude", "pi", "codex"] as const;

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
  claude: {
    displayName: "Claude Code",
    command: "claude",
    args: [],
    env: {},
    reconnectArgs: ["--continue"],
    reconnectEnv: "explicit",
  },
  pi: {
    displayName: "Pi",
    command: "pi",
    args: [],
    env: {},
    reconnectArgs: ["--continue"],
    reconnectEnv: "explicit",
  },
  codex: {
    displayName: "Codex",
    command: "codex",
    args: ["--no-daemon"],
    env: {},
    reconnectArgs: ["resume", "--last", "--no-daemon"],
    reconnectEnv: "explicit",
  },
};
