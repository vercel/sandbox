import * as cmd from "cmd-ts";
import { Sandbox } from "@vercel/sandbox";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import chalk, { ChalkInstance } from "chalk";
import ora from "ora";
import { acquireRelease } from "../util/disposables";
import { table, timeAgo, formatBytes, formatRunDuration } from "../util/output";
import { ObjectFromKeyValue } from "../args/key-value-pair";

export const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List all sandboxes for the specified account and project.",
  args: {
    all: cmd.flag({
      long: "all",
      short: "a",
      description: "Show all sandboxes (default shows just running)",
    }),
    namePrefix: cmd.option({
      long: "name-prefix",
      description: "Filter sandboxes by name prefix",
      type: cmd.optional(cmd.string),
    }),
    sortBy: cmd.option({
      long: "sort-by",
      description: "Sort sandboxes by field. Options: createdAt (default), name, statusUpdatedAt",
      type: cmd.optional(
        cmd.oneOf(["createdAt", "name", "statusUpdatedAt"] as const),
      ),
    }),
    sortOrder: cmd.option({
      long: "sort-order",
      description: "Sort order. Options: asc, desc (default)",
      type: cmd.optional(cmd.oneOf(["asc", "desc"] as const)),
    }),
    tags: cmd.multioption({
      long: "tag",
      description: 'Filter sandboxes by tag. Format: "key=value"',
      type: ObjectFromKeyValue,
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, all, namePrefix, sortBy, sortOrder, tags }) {
    if (namePrefix) {
      if (sortBy && sortBy !== "name") {
        console.error(chalk.red("Error: --sort-by must be 'name' when using --name-prefix"));
        return;
      }

      sortBy = 'name';
    }

    const sandboxes = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching sandboxes...").start(),
        (s) => s.stop(),
      );

      let { sandboxes } = await sandboxClient.list({
        token,
        teamId: team,
        projectId: project,
        limit: 50,
        ...(namePrefix && { namePrefix }),
        ...(sortBy && { sortBy }),
        ...(sortOrder && { sortOrder }),
        ...(Object.keys(tags).length > 0 && { tags }),
      });

      if (!all) {
        sandboxes = sandboxes.filter((x) => x.status === "running");
      }

      return sandboxes;
    })();

    const memoryFormatter = new Intl.NumberFormat(undefined, {
      style: "unit",
      unit: "megabyte",
    });

    type SandboxRow = (typeof sandboxes)[number];
    type Column = { value: (s: SandboxRow) => string | number; color?: (s: SandboxRow) => ChalkInstance };

    const columns: Record<string, Column> = {
      NAME: { value: (s) => s.name },
      STATUS: {
        value: (s) => s.status,
        color: (s) => SandboxStatusColor[s.status] ?? chalk.reset,
      },
      CREATED: {
        value: (s) => timeAgo(s.createdAt),
      },
      MEMORY: { value: (s) => s.memory != null ? memoryFormatter.format(s.memory) : "-" },
      VCPUS: { value: (s) => s.vcpus ?? "-" },
      RUNTIME: { value: (s) => s.runtime ?? "-" },
      TIMEOUT: {
        value: (s) => s.timeout != null ? timeAgo(s.createdAt + s.timeout) : "-",
      },
      SNAPSHOT: { value: (s) => s.currentSnapshotId ?? "-" },
      TAGS: { value: (s) => s.tags && Object.keys(s.tags).length > 0 ? Object.entries(s.tags).map(([k, v]) => `${k}:${v}`).join(", ") : "-" }
    };
    if (all) {
      columns.CPU = { value: (s) => s.totalActiveCpuDurationMs ? formatRunDuration(s.totalActiveCpuDurationMs) : "-" };
      columns["NETWORK (OUT/IN)"] = {
        value: (s) => (s.totalEgressBytes || s.totalIngressBytes) ?
          `${formatBytes(s.totalEgressBytes ?? 0)} / ${formatBytes(s.totalIngressBytes ?? 0)}` : "- / -",
      };
    }

    console.log(table({ rows: sandboxes, columns }));
  },
});

const SandboxStatusColor: Record<Sandbox["status"], ChalkInstance> = {
  running: chalk.cyan,
  failed: chalk.red,
  stopped: chalk.gray.dim,
  stopping: chalk.gray,
  pending: chalk.magenta,
  snapshotting: chalk.blue,
  aborted: chalk.gray.dim,
};
