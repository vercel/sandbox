import { command, parse, subcommands } from "cmd-ts";
import { commandMetadata } from "./command-metadata";
import { version } from "./pkg";

type CliCommand = Parameters<typeof subcommands>[0]["cmds"][string];
type CommandName = keyof typeof commandMetadata;

export const commandLoaders: Record<CommandName, () => Promise<CliCommand>> = {
  list: () => import("./commands/list").then(({ list }) => list),
  create: () => import("./commands/create").then(({ create }) => create),
  sh: () => import("./commands/sh").then(({ sh }) => sh),
  fork: () => import("./commands/fork").then(({ fork }) => fork),
  config: () => import("./commands/config").then(({ config }) => config),
  copy: () => import("./commands/cp").then(({ cp }) => cp),
  exec: () => import("./commands/exec").then(({ exec }) => exec),
  connect: () => import("./commands/connect").then(({ connect }) => connect),
  stop: () => import("./commands/stop").then(({ stop }) => stop),
  extend: () => import("./commands/extend").then(({ extend }) => extend),
  remove: () => import("./commands/remove").then(({ remove }) => remove),
  run: () => import("./commands/run").then(({ run }) => run),
  snapshot: () =>
    import("./commands/snapshot").then(({ snapshot }) => snapshot),
  snapshots: () =>
    import("./commands/snapshots").then(({ snapshots }) => snapshots),
  sessions: () =>
    import("./commands/sessions").then(({ sessions }) => sessions),
  drives: () => import("./commands/drives").then(({ drives }) => drives),
  telemetry: () =>
    import("./commands/telemetry").then(
      ({ telemetryCommand }) => telemetryCommand,
    ),
  login: () => import("./commands/login").then(({ login }) => login),
  logout: () => import("./commands/logout").then(({ logout }) => logout),
};

export const app = async (
  args: string[],
  opts?: { withoutAuth?: boolean; appName?: string },
) => {
  const appName = opts?.appName ?? "sandbox";
  const commands: Record<string, CliCommand> = {};
  for (const name of Object.keys(commandLoaders) as CommandName[]) {
    if (opts?.withoutAuth && (name === "login" || name === "logout")) {
      continue;
    }
    const metadata = commandMetadata[name];
    commands[name] = {
      ...command({
        ...metadata,
        args: {},
        handler() {
          throw new Error("Command must be loaded before execution");
        },
      }),
      helpTopics: () =>
        metadata.positionals.map((usage) => ({
          category: "arguments",
          usage,
          description: "",
          defaults: [],
        })),
      parse: async () => ({ _tag: "ok", value: {} }),
    };
  }
  const instance = subcommands({
    name: appName,
    description: "Interfacing with Vercel Sandbox",
    version,
    cmds: commands,
    examples: [
      {
        description: "Start a coding agent in a sandbox",
        command: `${appName} create opencode`,
      },
      {
        description:
          "Create a sandbox on a Secure Compute network (requires an Enterprise plan)",
        command: `${appName} create --network-id your_network_id_here`,
      },
      {
        description: "Create a sandbox and start a shell",
        command: `${appName} sh`,
      },
      {
        description: "Run a command in a new sandbox",
        command: `${appName} run -- node -e "console.log('hello')"`,
      },
      {
        description: "Execute command in an existing sandbox",
        command: `${appName} exec <name> -- npm test`,
      },
    ],
  });
  // Read the command name before loading its option definitions.
  const selected = await parse(instance, args);
  if (selected._tag === "ok") {
    const name = selected.value.command as CommandName;
    commands[name] = await commandLoaders[name]();
  }
  return instance;
};
