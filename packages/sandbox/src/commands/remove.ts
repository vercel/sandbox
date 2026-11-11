import { commandMetadata } from "../command-metadata";
import * as cmd from "cmd-ts";
import chalk from "chalk";
import { Listr } from "listr2";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient, snapshotClient } from "../client";
import { formatBytes } from "../util/output";

/** Snapshots a removed sandbox left behind, for the post-run report. */
type KeptSnapshots = {
  name: string;
  ids: string[];
  sizeBytes: number;
  more: boolean;
};

/** Snapshot ids to name in the follow-up command before it gets unwieldy. */
const MAX_LISTED_IDS = 5;

function printKeptSnapshots(kept: KeptSnapshots[]) {
  for (const { name, ids, sizeBytes, more } of kept) {
    const single = ids.length === 1 && !more;
    const amount = single
      ? `snapshot ${ids[0]}`
      : `${ids.length}${more ? "+" : ""} snapshots`;
    const listed = ids.slice(0, MAX_LISTED_IDS);
    const hint =
      `Delete with: sandbox snapshots delete ${listed.join(" ")}` +
      (ids.length > listed.length || more ? " ..." : "");

    process.stderr.write(
      chalk.dim("   ╰ ") +
        `${name}: kept ${chalk.cyan(amount)} (${chalk.cyan(formatBytes(sizeBytes))}), billed until ` +
        (single ? "it expires" : "they expire") +
        ". " +
        chalk.dim(hint) +
        "\n",
    );
  }
}

export const remove = cmd.command({
  ...commandMetadata.remove,
  args: {
    sandboxName: cmd.positional({
      type: sandboxName,
      description: "a sandbox name to remove",
    }),
    sandboxNames: cmd.restPositionals({
      type: sandboxName,
      description: "more sandboxes to remove",
    }),
    deleteOrphanSnapshots: cmd.flag({
      long: "delete-orphan-snapshots",
      description:
        "Also delete the snapshots of the sandbox that are not used by any other sandbox",
    }),
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandboxName,
    sandboxNames,
    deleteOrphanSnapshots,
  }) {
    const kept: KeptSnapshots[] = [];

    const tasks = Array.from(
      new Set([sandboxName, ...sandboxNames]),
      (name) => ({
        title: `Removing sandbox ${name}`,
        async task() {
          const sandbox = await sandboxClient.get({
            token,
            teamId: team,
            projectId: project,
            name,
          });

          // Read the snapshots before the sandbox is gone, so the report can
          // say what removal left behind. Only needed when they are kept.
          const snapshots = deleteOrphanSnapshots
            ? null
            : await snapshotClient
                .list({
                  token,
                  teamId: team,
                  projectId: project,
                  name,
                  limit: 50,
                })
                .catch(() => null);

          await sandbox.delete({ deleteOrphanSnapshots });

          const remaining =
            snapshots?.snapshots.filter((s) => s.status !== "deleted") ?? [];
          if (remaining.length > 0) {
            kept.push({
              name,
              ids: remaining.map((s) => s.id),
              sizeBytes: remaining.reduce((total, s) => total + s.sizeBytes, 0),
              more: (snapshots?.pagination.next ?? null) !== null,
            });
          }
        },
      }),
    );
    try {
      await new Listr(tasks, { concurrent: true }).run();
    } catch {
      // Listr already rendered the error; just set exit code
      process.exitCode = 1;
    }

    printKeptSnapshots(kept);
  },
});
