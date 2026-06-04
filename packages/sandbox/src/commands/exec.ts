import { Sandbox } from "@vercel/sandbox";
import * as cmd from "cmd-ts";
import ms from "ms";
import { sandboxName } from "../args/sandbox-name";
import { isatty } from "node:tty";
import { startInteractiveShell } from "../interactive-shell/interactive-shell";
import { printCommand } from "../util/print-command";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { scope } from "../args/scope";
import { Duration } from "../types/duration";
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
  timeout: cmd.option({
    long: "timeout",
    type: cmd.optional(Duration),
    description:
      "Maximum duration to wait for the command (e.g. 30s, 5m). " +
      "On expiry the process is killed with SIGKILL. " +
      "Cannot be combined with --interactive.",
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
    timeout,
  }) {
    if (interactive && timeout) {
      throw new Error(
        [
          "--timeout cannot be combined with --interactive.",
          `${chalk.bold("hint:")} Remove one of the two flags. Interactive sessions do not enforce a command timeout.`,
        ].join("\n"),
      );
    }

    const sandbox =
      typeof sandboxName !== "string"
        ? sandboxName
        : await sandboxClient.get({
            name: sandboxName,
            projectId: project,
            teamId: team,
            token,
            // Resume up front so the sandbox is already running by the time the
            // interactive-shell setup runs its parallel steps.
            resume: true,
            __includeSystemRoutes: true,
          });

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
        timeoutMs: timeout ? ms(timeout) : undefined,
      });

      // Exit code 137 (128 + SIGKILL) is how a `--timeout` kill surfaces.
      if (timeout && result.exitCode === 137) {
        console.error(
          `${chalk.yellow("Command was killed (SIGKILL, exit code 137)")}.`,
        );
      }

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
