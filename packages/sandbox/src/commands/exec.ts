import { Sandbox } from "@vercel/sandbox";
import * as cmd from "cmd-ts";
import { sandboxName } from "../args/sandbox-name";
import { isatty } from "node:tty";
import { startInteractiveShell } from "../interactive-shell/interactive-shell";
import { printCommand } from "../util/print-command";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import chalk from "chalk";

export const args = {
  sandbox: cmd.positional({
    type: sandboxName as cmd.Type<string, string | Sandbox>,
  }),
  command: cmd.positional({
    displayName: "command",
    description: "The executable to invoke",
  }),
  args: cmd.rest({
    displayName: "args",
    description: "arguments to pass to the command",
  }),
  asSudo: cmd.flag({
    long: "sudo",
    description: "Give extended privileges to the command.",
  }),
  interactive: cmd.flag({
    long: "interactive",
    short: "i",
    description: "Run the command in a secure interactive shell",
    type: cmd.extendType(cmd.boolean, {
      defaultValue() {
        return false;
      },
      async from(input) {
        if (input && !isatty(1)) {
          throw new Error(
            [
              `The --interactive flag requires a terminal (TTY).`,
              `${chalk.bold("hint:")} Run this command in an interactive terminal, or remove --interactive to run non-interactively.`,
            ].join("\n"),
          );
        }
        return input;
      },
    }),
  }),
  skipExtendingTimeout: cmd.flag({
    long: "no-extend-timeout",
    description:
      "Do not extend the sandbox timeout while running an interactive command. Only affects interactive executions.",
  }),
  tty: cmd.flag({
    long: "tty",
    short: "t",
    description: "Allocate a tty for an interactive command. This is a no-op.",
  }),
  cwd: cmd.option({
    long: "workdir",
    short: "w",
    description: "The working directory to run the command in",
    type: cmd.optional(cmd.string),
  }),
  envVars: cmd.multioption({
    long: "env",
    short: "e",
    type: ObjectFromKeyValue,
    description: "Environment variables to set for the command",
  }),
  stopAfterUse: cmd.flag({
    long: "stop",
    description: "Stop the sandbox when the command exits.",
  }),
  scope,
} as const;

export const exec = cmd.command({
  name: "exec",
  description: "Execute a command in an existing sandbox",
  args,
  async handler({
    command,
    cwd,
    args,
    asSudo,
    sandbox: sandboxName,
    scope: { token, team, project },
    interactive,
    envVars,
    skipExtendingTimeout,
    stopAfterUse,
  }) {
    const sandbox =
      typeof sandboxName !== "string"
        ? sandboxName
        : await sandboxClient.get({
            name: sandboxName,
            projectId: project,
            teamId: team,
            token,
            __includeSystemRoutes: true,
          });

    try {
      if (!interactive) {
        console.error(printCommand(command, args));
        const result = await sandbox.runCommand({
          cmd: command,
          args,
          stderr: process.stderr,
          stdout: process.stdout,
          sudo: asSudo,
          cwd,
          env: envVars,
        });

        process.exitCode = result.exitCode;
      } else {
        await startInteractiveShell({
          sandbox,
          cwd,
          execution: [command, ...args],
          envVars,
          sudo: asSudo,
          skipExtendingTimeout,
        });
      }
    } finally {
      if (stopAfterUse) {
        await sandbox.stop();
      }
    }
  },
});
