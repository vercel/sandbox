import { Sandbox } from "@vercel/sandbox";
import * as cmd from "cmd-ts";
import { sandboxId } from "../args/sandbox-id";
import { isatty } from "node:tty";
import { startInteractiveShell } from "../interactive-shell/interactive-shell";
import { printCommand } from "../util/print-command";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { scope } from "../args/scope";
import { sandboxClient, snapshotClient } from "../client";
import chalk from "chalk";
import ora from "ora";

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
    let sandbox =
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
      if (sandbox.status === "stopped") {
        const resumed = await tryResumeFromSnapshot({
          stoppedSandbox: sandbox,
          token,
          team,
          project,
        });
        if (resumed) {
          sandbox = resumed;
        } else {
          console.error(
            [
              `Sandbox ${sandbox.sandboxId} is stopped and no snapshots were found to resume from.`,
              `${chalk.bold("hint:")} To preserve state across sessions, snapshot your sandbox before it stops:`,
              "├▶ Use `sandbox snapshot <sandbox_id> --stop` on a running sandbox.",
              "╰▶ Use `sandbox create` to create a new sandbox.",
            ].join("\n"),
          );
          process.exitCode = 1;
          return;
        }
      } else {
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

async function tryResumeFromSnapshot({
  stoppedSandbox,
  token,
  team,
  project,
}: {
  stoppedSandbox: Sandbox;
  token: string;
  team: string;
  project: string;
}): Promise<Sandbox | null> {
  const spinner = ora(
    `Sandbox ${stoppedSandbox.sandboxId} is stopped. Looking for snapshots to resume from...`,
  ).start();

  try {
    const { json } = await snapshotClient.list({
      token,
      teamId: team,
      projectId: project,
      limit: 100,
    });

    const matching = json.snapshots
      .filter(
        (s) =>
          s.sourceSandboxId === stoppedSandbox.sandboxId &&
          s.status === "created",
      )
      .sort((a, b) => b.createdAt - a.createdAt);

    if (matching.length === 0) {
      spinner.fail("No snapshots found for this sandbox.");
      return null;
    }

    const snapshot = matching[0];
    spinner.text = `Resuming from snapshot ${snapshot.id}...`;

    const newSandbox = await sandboxClient.create({
      source: { type: "snapshot", snapshotId: snapshot.id },
      teamId: team,
      projectId: project,
      token,
      __interactive: true,
    });

    spinner.succeed(
      `Resumed as new sandbox ${chalk.cyan(newSandbox.sandboxId)} (from snapshot ${snapshot.id}).`,
    );
    return newSandbox;
  } catch (err) {
    spinner.fail("Failed to resume from snapshot.");
    throw err;
  }
}
