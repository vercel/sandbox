import { commandMetadata } from "../command-metadata";
import * as cmd from "cmd-ts";
import chalk from "chalk";
import { Listr } from "listr2";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient, snapshotClient } from "../client";
import { formatBytes, timeAgo } from "../util/output";

/** What a removal left behind, for the post-run report. */
type RemovalReport =
  | {
      name: string;
      kind: "kept";
      ids: string[];
      sizeBytes: number;
      /** The listing was paginated, so ids and sizeBytes are partial. */
      partial: boolean;
      /** Expiration of the only snapshot, when there is exactly one. */
      expiresAt: number | null;
    }
  | { name: string; kind: "unknown" };

/** Snapshot ids to name in the follow-up command before it gets unwieldy. */
const MAX_LISTED_IDS = 5;

function keptLine(report: Extract<RemovalReport, { kind: "kept" }>): string {
  const { name, ids, sizeBytes, partial, expiresAt } = report;
  const size = formatBytes(sizeBytes);
  const listed = ids.slice(0, MAX_LISTED_IDS);
  const truncated = partial || ids.length > listed.length;
  const command = `sandbox snapshots delete ${listed.join(" ")}${truncated ? " ..." : ""}`;

  if (ids.length === 1 && !partial) {
    const expiry = expiresAt ? `expires ${timeAgo(expiresAt)}` : "no expiry";
    return (
      `${name}: kept snapshot ${chalk.cyan(ids[0])} (${chalk.cyan(size)}, ${expiry}). ` +
      chalk.dim(`Delete it with: ${command}`)
    );
  }

  const count = `${ids.length}${partial ? "+" : ""} snapshots`;
  const total = partial ? `${size} so far` : size;
  return (
    `${name}: kept ${chalk.cyan(count)} (${chalk.cyan(total)}). ` +
    chalk.dim(`Delete the ones no other sandbox uses: ${command}`)
  );
}

function printReports(reports: RemovalReport[]) {
  for (const report of reports) {
    const line =
      report.kind === "kept"
        ? keptLine(report)
        : `${report.name}: could not list snapshots, so any it kept are not shown. ` +
          chalk.dim("Check with: sandbox snapshots ls");
    process.stderr.write(chalk.dim("   ╰ ") + line + "\n");
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
    const reports: RemovalReport[] = [];
    let failed = false;

    const tasks = Array.from(
      new Set([sandboxName, ...sandboxNames]),
      (name) => ({
        title: `Removing sandbox ${name}`,
        async task() {
          try {
            await removeOne(name);
          } catch (error) {
            failed = true;
            throw error;
          }
        },
      }),
    );

    async function removeOne(name: string) {
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
            .catch(() => "unavailable" as const);

      await sandbox.delete({ deleteOrphanSnapshots });

      if (snapshots === "unavailable") {
        reports.push({ name, kind: "unknown" });
        return;
      }
      if (snapshots === null) return;

      // Only "created" snapshots are billable and deletable. Anything in
      // another status would inflate the total and break the delete hint.
      const kept = snapshots.snapshots.filter((s) => s.status === "created");
      if (kept.length === 0) return;

      reports.push({
        name,
        kind: "kept",
        ids: kept.map((s) => s.id),
        sizeBytes: kept.reduce((total, s) => total + s.sizeBytes, 0),
        partial: snapshots.pagination.next !== null,
        expiresAt: kept.length === 1 ? (kept[0].expiresAt ?? null) : null,
      });
    }

    // exitOnError keeps the other removals going when one fails, so the report
    // still covers every sandbox that was actually removed.
    await new Listr(tasks, { concurrent: true, exitOnError: false }).run();
    if (failed) process.exitCode = 1;

    printReports(reports);
  },
});
