import * as cmd from "cmd-ts";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";

const args = {
  sandbox: cmd.positional({
    type: sandboxName,
    description: "Sandbox with a running session",
  }),
  commandId: cmd.positional({
    displayName: "command-id",
    description: "ID returned by sandbox exec --detach",
  }),
  scope,
} as const;

async function getCurrentCommand({
  sandbox: name,
  commandId,
  scope: { token, team, project },
}: {
  sandbox: string;
  commandId: string;
  scope: { token: string; team: string; project: string };
}) {
  const sandbox = await sandboxClient.get({
    name,
    projectId: project,
    teamId: team,
    token,
    resume: false,
  });
  const session = (() => {
    try {
      return sandbox.currentSession();
    } catch {
      return null;
    }
  })();
  if (session?.status !== "running") {
    throw new Error(
      `Sandbox ${name} has no running session for command ${commandId}.`,
    );
  }
  return session.getCommand(commandId);
}

const get = cmd.command({
  name: "get",
  description: "Show the status of a command in the current session",
  args,
  async handler(input) {
    const command = await getCurrentCommand(input);
    process.stdout.write(
      `${command.cmdId}\t${command.exitCode === null ? "running" : `exited (${command.exitCode})`}\n`,
    );
  },
});

const logs = cmd.command({
  name: "logs",
  description: "Stream a command's stdout and stderr",
  args,
  async handler(input) {
    const command = await getCurrentCommand(input);
    for await (const log of command.logs()) {
      (log.stream === "stdout" ? process.stdout : process.stderr).write(
        log.data,
      );
    }
  },
});

const wait = cmd.command({
  name: "wait",
  description: "Wait for a command to finish and return its exit code",
  args,
  async handler(input) {
    const command = await getCurrentCommand(input);
    const finished = await command.wait();
    process.stderr.write(
      `Command ${command.cmdId} exited with ${finished.exitCode}.\n`,
    );
    process.exitCode = finished.exitCode;
  },
});

const kill = cmd.command({
  name: "kill",
  description: "Stop a running command without stopping its sandbox",
  args: {
    ...args,
    signal: cmd.option({
      long: "signal",
      description: "Signal to send (default SIGTERM)",
      type: cmd.optional(cmd.oneOf(["SIGTERM", "SIGKILL"] as const)),
    }),
  },
  async handler({ signal, ...input }) {
    const command = await getCurrentCommand(input);
    await command.kill(signal);
    process.stderr.write(
      `Sent ${signal ?? "SIGTERM"} to command ${command.cmdId}.\n`,
    );
  },
});

const write = cmd.command({
  name: "write",
  description: "Write piped bytes to a command started with --detach --stdin",
  args,
  async handler(input) {
    if (process.stdin.isTTY) {
      throw new Error(
        "Pipe data to sandbox commands write, for example: printf 'hello\\n' | sandbox commands write <name> <command-id>.",
      );
    }
    const command = await getCurrentCommand(input);
    for await (const chunk of process.stdin) {
      await command.writeStdin(chunk);
    }
  },
});

const closeStdin = cmd.command({
  name: "close-stdin",
  description: "Send EOF to a command started with --detach --stdin",
  args,
  async handler(input) {
    const command = await getCurrentCommand(input);
    await command.closeStdin();
  },
});

const output = cmd.command({
  name: "output",
  description: "Print a command's output from stdout, stderr, or both",
  args: {
    ...args,
    stream: cmd.option({
      long: "stream",
      description: "Output stream to print (default both)",
      type: cmd.optional(cmd.oneOf(["stdout", "stderr", "both"] as const)),
    }),
  },
  async handler({ stream, ...input }) {
    const command = await getCurrentCommand(input);
    process.stdout.write(await command.output(stream ?? "both"));
  },
});

export const commands = cmd.subcommands({
  name: "commands",
  description: "Inspect and control commands in a running sandbox session",
  cmds: { get, logs, wait, kill, write, "close-stdin": closeStdin, output },
});
