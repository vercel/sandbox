import * as cmd from "cmd-ts";
import chalk from "chalk";
import ora from "ora";
import type { Sandbox } from "@vercel/sandbox";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { formatBytes, formatRunDuration, timeAgo } from "../util/output";

type StopResult = Awaited<ReturnType<Sandbox["stop"]>>;

type Cell = { label: string; value: string } | null;

function cell(label: string, value: string): Cell {
  return { label, value };
}

function printStopResult(name: string, sandbox: Sandbox, sessionSnapshot: StopResult) {
  process.stderr.write(chalk.green("✔") + " Sandbox stopped.\n");

  // Build rows as cells with label/value pairs
  const sbxRow: Cell[] = [
    cell("sandbox: ", name),
    sandbox.totalActiveCpuDurationMs != null ? cell("active cpu: ", formatRunDuration(sandbox.totalActiveCpuDurationMs)) : null,
    sandbox.memory != null ? cell("mem: ", `${sandbox.memory} MB`) : null,
    sandbox.totalDurationMs != null ? cell("duration: ", formatRunDuration(sandbox.totalDurationMs)) : null,
    sandbox.totalIngressBytes != null ? cell("ingress: ", formatBytes(sandbox.totalIngressBytes)) : null,
    sandbox.totalEgressBytes != null ? cell("egress: ", formatBytes(sandbox.totalEgressBytes)) : null,
  ];

  const sessRow: Cell[] = [
    cell("session: ", sessionSnapshot.id),
    sessionSnapshot.activeCpuDurationMs != null ? cell("active cpu: ", formatRunDuration(sessionSnapshot.activeCpuDurationMs)) : null,
    cell("mem: ", `${sessionSnapshot.memory} MB`),
    sessionSnapshot.duration != null ? cell("duration: ", formatRunDuration(sessionSnapshot.duration)) : null,
    sessionSnapshot.networkTransfer ? cell("ingress: ", formatBytes(sessionSnapshot.networkTransfer.ingress)) : null,
    sessionSnapshot.networkTransfer ? cell("egress: ", formatBytes(sessionSnapshot.networkTransfer.egress)) : null,
  ];

  const snapshot = sessionSnapshot.snapshot;
  const snapRow: Cell[] = snapshot
    ? [
        cell("snapshot: ", snapshot.id),
        cell("size: ", formatBytes(snapshot.sizeBytes)),
        cell("expires: ", snapshot.expiresAt ? timeAgo(snapshot.expiresAt) : "never"),
      ]
    : [];

  const rows = [sbxRow, sessRow, ...(snapRow.length ? [snapRow] : [])];

  // Compute column widths based on visible text (label + value)
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths = Array.from<number>({ length: colCount }).fill(0);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c) {
        colWidths[i] = Math.max(colWidths[i], c.label.length + c.value.length);
      }
    }
  }

  const formatRow = (row: Cell[], isLast: boolean) => {
    const prefix = isLast ? chalk.dim("   ╰ ") : chalk.dim("   │ ");
    const cells = row.map((c, i) => {
      if (!c) return " ".repeat(colWidths[i]);
      const padding = colWidths[i] - c.label.length - c.value.length;
      return c.label + chalk.cyan(c.value) + (padding > 0 ? " ".repeat(padding) : "");
    });
    return prefix + cells.join("  ").trimEnd() + "\n";
  };

  const totalRows = rows.length;
  for (let i = 0; i < totalRows; i++) {
    process.stderr.write(formatRow(rows[i], i === totalRows - 1));
  }
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
