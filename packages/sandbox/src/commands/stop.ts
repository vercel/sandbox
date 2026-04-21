import * as cmd from "cmd-ts";
import chalk from "chalk";
import ora from "ora";
import type { Sandbox } from "@vercel/sandbox";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { formatBytes, formatRunDuration, timeAgo } from "../util/output";

type StopResult = Awaited<ReturnType<Sandbox["stop"]>>;

/** Label/value pair; null means empty (used for column alignment). */
type Cell = { label: string; value: string } | null;

function c(label: string, value: string): Cell {
  return { label, value };
}

/** Visible width of a cell (label + value, no ANSI). */
function cellWidth(cell: Cell): number {
  return cell ? cell.label.length + cell.value.length : 0;
}

/** Print rows as a tree with column-aligned label: value pairs. */
function printTree(rows: Cell[][]) {
  // Column widths
  const widths: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      widths[i] = Math.max(widths[i] ?? 0, cellWidth(row[i]));
    }
  }

  for (let r = 0; r < rows.length; r++) {
    const isLast = r === rows.length - 1;
    const prefix = isLast ? chalk.dim("   ╰ ") : chalk.dim("   │ ");
    const line = rows[r]
      .map((cell, i) => {
        if (!cell) return " ".repeat(widths[i]);
        const pad = widths[i] - cell.label.length - cell.value.length;
        return cell.label + chalk.cyan(cell.value) + " ".repeat(Math.max(0, pad));
      })
      .join("  ")
      .trimEnd();
    process.stderr.write(prefix + line + "\n");
  }
}

function printStopResult(name: string, sandbox: Sandbox, sessionSnapshot: StopResult) {
  process.stderr.write(chalk.green("✔") + " Sandbox stopped.\n");

  const snapshot = sessionSnapshot.snapshot;

  const rows: Cell[][] = [
    [
      c("sandbox: ", name),
      sandbox.totalActiveCpuDurationMs != null ? c("active cpu: ", formatRunDuration(sandbox.totalActiveCpuDurationMs)) : null,
      sandbox.memory != null ? c("mem: ", `${sandbox.memory} MB`) : null,
      sandbox.totalDurationMs != null ? c("duration: ", formatRunDuration(sandbox.totalDurationMs)) : null,
      sandbox.totalIngressBytes != null ? c("ingress: ", formatBytes(sandbox.totalIngressBytes)) : null,
      sandbox.totalEgressBytes != null ? c("egress: ", formatBytes(sandbox.totalEgressBytes)) : null,
    ],
    [
      c("session: ", sessionSnapshot.id),
      sessionSnapshot.activeCpuDurationMs != null ? c("active cpu: ", formatRunDuration(sessionSnapshot.activeCpuDurationMs)) : null,
      c("mem: ", `${sessionSnapshot.memory} MB`),
      sessionSnapshot.duration != null ? c("duration: ", formatRunDuration(sessionSnapshot.duration)) : null,
      sessionSnapshot.networkTransfer ? c("ingress: ", formatBytes(sessionSnapshot.networkTransfer.ingress)) : null,
      sessionSnapshot.networkTransfer ? c("egress: ", formatBytes(sessionSnapshot.networkTransfer.egress)) : null,
    ],
    ...(snapshot
      ? [[
          c("snapshot: ", snapshot.id),
          c("size: ", formatBytes(snapshot.sizeBytes)),
          c("expires: ", snapshot.expiresAt ? timeAgo(snapshot.expiresAt) : "never"),
        ]]
      : []),
  ];

  printTree(rows);
}

export const stop = cmd.command({
  name: "stop",
  description: "Stop the current session of one or more sandboxes",
  args: {
    sandboxName: cmd.positional({
      type: sandboxName,
      description: "A sandbox name to stop",
    }),
    sandboxNames: cmd.restPositionals({
      type: sandboxName,
      description: "More sandboxes to stop",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, sandboxName, sandboxNames }) {
    const names = Array.from(new Set([sandboxName, ...sandboxNames]));
    const spinner = ora({
      text: names.length === 1
        ? `Stopping ${names[0]}`
        : `Stopping ${names.length} sandboxes`,
      stream: process.stderr,
    }).start();

    const results = await Promise.allSettled(
      names.map(async (name) => {
        const sandbox = await sandboxClient.get({
          token,
          teamId: team,
          projectId: project,
          name,
        });
        const sessionSnapshot = await sandbox.stop();
        return { name, sandbox, sessionSnapshot };
      }),
    );

    spinner.stop();

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { name, sandbox, sessionSnapshot } = result.value;
        printStopResult(name, sandbox, sessionSnapshot);
      } else {
        const error = result.reason;
        process.stderr.write(chalk.red("✖") + ` ${error.message ?? error}\n`);
        process.exitCode = 1;
      }
    }
  },
});
