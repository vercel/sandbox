import * as cmd from "cmd-ts";
import { sandboxId } from "../args/sandbox-id";
import { Sandbox } from "@vercel/sandbox";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import chalk from "chalk";
import ora from "ora";

export const args = {
  stop: cmd.flag({
    long: "stop",
    description: "Confirm that the sandbox will be stopped when snapshotting",
  }),
  silent: cmd.flag({
    long: "silent",
    description: "Don't write snapshot ID to stdout",
  }),
  sandbox: cmd.positional({
    type: sandboxId as cmd.Type<string, string | Sandbox>,
  }),
  scope,
} as const;

export const snapshot = cmd.command({
  name: "snapshot",
  description: "Take a snapshot of the filesystem of a sandbox",
  args,
  async handler({
    sandbox: sandboxId,
    stop,
    scope: { token, team, project },
    silent,
  }) {
    if (!stop) {
      console.error(
        [
          "Snapshotting a sandbox will automatically stop it.",
          `${chalk.bold("hint:")} Confirm with --stop to continue.`,
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }

    const sandbox =
      typeof sandboxId !== "string"
        ? sandboxId
        : await sandboxClient.get({
            sandboxId,
            projectId: project,
            teamId: team,
            token,
          });

    if (!["running"].includes(sandbox.status)) {
      console.error(
        [
          `Sandbox ${sandbox.sandboxId} is not available (status: ${sandbox.status}).`,
          `${chalk.bold("hint:")} Only 'running' sandboxes can be snapshotted.`,
          "├▶ Use `sandbox list` to check sandbox status.",
          "╰▶ Use `sandbox create` to create a new sandbox.",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }

    const spinner = silent ? undefined : ora("Creating snapshot...").start();
    const snapshot = await sandbox.snapshot();
    spinner?.succeed(`Snapshot ${snapshot.snapshotId} created.`);
  },
});
