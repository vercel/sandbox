import * as cmd from "cmd-ts";
import { subcommands } from "cmd-ts";
import chalk, { type ChalkInstance } from "chalk";
import ora from "ora";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { acquireRelease } from "../util/disposables";
import { table, timeAgo, formatBytes, formatRunDuration } from "../util/output";
import type { Sandbox } from "@vercel/sandbox";

const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List sessions from a sandbox",
  args: {
    all: cmd.flag({
      long: "all",
      short: "a",
      description: "Show all sessions (default shows just running)",
    }),
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to list sessions for",
    }),
    sortOrder: cmd.option({
      long: "sort-order",
      description: "Sort order. Options: asc, desc (default)",
      type: cmd.optional(cmd.oneOf(["asc", "desc"] as const)),
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, all, sandbox: name, sortOrder }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    let { sessions } = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching sessions...").start(),
        (s) => s.stop(),
      );
      return sandbox.listSessions({
        ...(sortOrder && { sortOrder }),
      });
    })();

    if (!all) {
      sessions = sessions.filter((x) => x.status === "running");
    }

    const memoryFormatter = new Intl.NumberFormat(undefined, {
      style: "unit",
      unit: "megabyte",
    });

    type SessionRow = (typeof sessions)[number];
    type Column = { value: (s: SessionRow) => string | number; color?: (s: SessionRow) => ChalkInstance };

    const columns: Record<string, Column> = {
      ID: { value: (s) => s.id },
      STATUS: {
        value: (s) => s.status,
        color: (s) => SessionStatusColor[s.status] ?? chalk.reset,
      },
      CREATED: { value: (s) => timeAgo(s.createdAt) },
      MEMORY: { value: (s) => memoryFormatter.format(s.memory) },
      VCPUS: { value: (s) => s.vcpus },
      RUNTIME: { value: (s) => s.runtime },
      TIMEOUT: {
        value: (s) => timeAgo(s.createdAt + s.timeout),
      },
      DURATION: {
        value: (s) => s.duration ? formatRunDuration(s.duration) : "-",
      },
      SNAPSHOT: { value: (s) => s.sourceSnapshotId ?? "-" },
    };
    if (all) {
      columns.CPU = { value: (s) => s.activeCpuDurationMs ? formatRunDuration(s.activeCpuDurationMs) : "-" };
      columns["NETWORK (OUT/IN)"] = {
        value: (s) => (s.networkTransfer?.egress || s.networkTransfer?.ingress) ?
          `${formatBytes(s.networkTransfer?.egress ?? 0)} / ${formatBytes(s.networkTransfer?.ingress ?? 0)}` : "- / -",
      };
    }

    console.log(table({ rows: sessions, columns }));
  },
});

export const sessions = subcommands({
  name: "sessions",
  description: "Manage sandbox sessions",
  cmds: {
    list,
  },
});

const SessionStatusColor: Record<Sandbox["status"], ChalkInstance> = {
  running: chalk.cyan,
  failed: chalk.red,
  stopped: chalk.gray.dim,
  stopping: chalk.gray,
  pending: chalk.magenta,
  snapshotting: chalk.blue,
  aborted: chalk.gray.dim,
};
