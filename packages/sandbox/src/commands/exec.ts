import { Sandbox } from "@vercel/sandbox";
import * as cmd from "cmd-ts";
import { sandboxId } from "../args/sandbox-id";
import { isatty } from "node:tty";
import { startInteractiveShell } from "../interactive-shell/interactive-shell";
import { printCommand } from "../util/print-command";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import chalk from "chalk";

export const args = {
  sandbox: cmd.positional({
    type: sandboxId as cmd.Type<string, string | Sandbox>,
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
    sandbox: sandboxId,
    scope: { token, team, project },
    interactive,
    envVars,
    skipExtendingTimeout,
  }) {
    const sandbox =
      typeof sandboxId !== "string"
        ? sandboxId
        : await sandboxClient.get({
            sandboxId,
            projectId: project,
            teamId: team,
            token,
            __includeSystemRoutes: true,
          });

    if (!["pending", "running"].includes(sandbox.status)) {
      console.error(
        [
          `Sandbox ${sandbox.sandboxId} is not available (status: ${sandbox.status}).`,
          `${chalk.bold("hint:")} Only 'pending' or 'running' sandboxes can execute commands.`,
          "├▶ Use `sandbox list` to check sandbox status.",
          "╰▶ Use `sandbox create` to create a new sandbox.",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }

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
  },
});
