export interface CommandMetadata {
  name: string;
  description: string;
  aliases?: string[];
  positionals: string[];
}

export const commandMetadata = {
  list: {
    name: "list",
    description: "List all sandboxes for the specified account and project.",
    aliases: ["ls"],
    positionals: [],
  },
  create: {
    name: "create",
    description: "Create a sandbox in the specified account and project.",
    positionals: ["[agent]"],
  },
  sh: {
    name: "sh",
    description: "Create a sandbox and start an interactive shell",
    positionals: [],
  },
  fork: {
    name: "fork",
    description:
      "Fork an existing sandbox into a new one. The fork starts from the source's latest snapshot (or a fresh copy of its runtime when it has none) and copies its config (cpu, timeout, network policy, tags, env vars, etc.); any flag passed here overrides the copied value. Changes made in a running source since its last snapshot are not included: run `sandbox snapshot --stop <source>` first to fork the current filesystem.",
    positionals: ["<source>"],
  },
  config: {
    name: "config",
    description: "View and update sandbox configuration",
    positionals: [],
  },
  copy: {
    name: "copy",
    description:
      "Copy files between your local filesystem and a remote sandbox",
    aliases: ["cp"],
    positionals: ["<src>", "<dst>"],
  },
  exec: {
    name: "exec",
    description: "Execute a command in an existing sandbox",
    positionals: ["<name>", "<command>", "[...args]"],
  },
  connect: {
    name: "connect",
    description: "Start an interactive shell in an existing sandbox",
    aliases: ["ssh", "shell"],
    positionals: ["<name>"],
  },
  stop: {
    name: "stop",
    description: "Stop the current session of one or more sandboxes",
    positionals: ["<name>", "[...name]"],
  },
  extend: {
    name: "extend",
    description:
      "Add time to a running session without changing its default timeout",
    positionals: ["<name>", "<num UNIT>"],
  },
  remove: {
    name: "remove",
    description: "Permanently remove one or more sandboxes",
    aliases: ["rm"],
    positionals: ["<name>", "[...name]"],
  },
  run: {
    name: "run",
    description: "Create and run a command in a sandbox",
    positionals: ["<command>", "[...args]"],
  },
  snapshot: {
    name: "snapshot",
    description: "Take a snapshot of the filesystem of a sandbox",
    positionals: ["<name>"],
  },
  snapshots: {
    name: "snapshots",
    description: "Manage sandbox snapshots",
    positionals: [],
  },
  sessions: {
    name: "sessions",
    description: "Manage sandbox sessions",
    positionals: [],
  },
  drives: {
    name: "drives",
    description: "Manage sandbox drives",
    positionals: [],
  },
  telemetry: {
    name: "telemetry",
    description: "Manage telemetry collection status",
    positionals: [],
  },
  login: {
    name: "login",
    description: "Log in to the Sandbox CLI",
    positionals: [],
  },
  logout: {
    name: "logout",
    description: "Log out of the Sandbox CLI",
    positionals: [],
  },
} satisfies Record<string, CommandMetadata>;
