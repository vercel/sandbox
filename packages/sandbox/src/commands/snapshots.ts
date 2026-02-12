import * as cmd from "cmd-ts";
import { subcommands } from "cmd-ts";
import { Listr } from "listr2";
import chalk, { ChalkInstance } from "chalk";
import ora from "ora";
import { scope } from "../args/scope";
import { snapshotId } from "../args/snapshot-id";
import { snapshotClient } from "../client";
import { acquireRelease } from "../util/disposables";
import { formatBytes, table, timeAgo } from "../util/output";

const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List snapshots for the specified account and project.",
  args: {
    scope, // only arg, position doesn't matter
  },
  async handler({ scope: { token, team, project } }) {
    const snapshots = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching snapshots...").start(),
        (s) => s.stop(),
      );
      const { json } = await snapshotClient.list({
        token,
        teamId: team,
        projectId: project,
        limit: 100,
      });
      return json.snapshots;
    })();

    console.log(
      table({
        rows: snapshots,
        columns: {
          ID: { value: (s) => s.id },
          STATUS: {
            value: (s) => s.status,
            color: (s) => SnapshotStatusColor.get(s.status) ?? chalk.reset,
          },
          CREATED: { value: (s) => timeAgo(s.createdAt) },
          EXPIRATION: {
            value: (s) =>
              s.status === "deleted"
                ? chalk.gray.dim("deleted")
                : timeAgo(s.expiresAt),
          },
          SIZE: { value: (s) => formatBytes(s.sizeBytes) },
          ["SOURCE SANDBOX"]: { value: (s) => s.sourceSandboxId },
        },
      }),
    );
  },
});

const remove = cmd.command({
  name: "delete",
  aliases: ["rm", "remove"],
  description: "Delete one or more snapshots.",
  args: {
    snapshotId: cmd.positional({
      type: snapshotId,
      description: "snapshot ID to delete",
    }),
    snapshotIds: cmd.restPositionals({
      type: snapshotId,
      description: "More snapshots IDs to delete",
    }),
    scope,
  },
  async handler({ scope: { team, token, project }, snapshotId, snapshotIds }) {
    const tasks = Array.from(
      new Set([snapshotId, ...snapshotIds]),
      (snapshotId) => {
        return {
          title: `Deleting snapshot ${snapshotId}`,
          async task() {
            const snapshot = await snapshotClient.get({
              token,
              teamId: team,
              projectId: project,
              snapshotId,
            });
            if (snapshot.status !== "created") {
              throw new Error(
                `Snapshot ${snapshotId} is in status "${snapshot.status}" and cannot be deleted.`,
              );
            }
            await snapshot.delete();
          },
        };
      },
    );
    await new Listr(tasks, { concurrent: true }).run();
  },
});

export const snapshots = subcommands({
  name: "snapshots",
  description: "Manage sandbox snapshots",
  cmds: {
    list,
    delete: remove,
  },
});

const SnapshotStatusColor = new Map<string, ChalkInstance>([
  ["created", chalk.cyan],
  ["deleted", chalk.gray.dim],
  ["failed", chalk.red],
]);
