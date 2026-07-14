import * as cmd from "cmd-ts";
import { Sandbox } from "@vercel/sandbox";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import chalk, { ChalkInstance } from "chalk";
import ora from "ora";
import { acquireRelease } from "../util/disposables";
import { table, timeAgo, formatBytes, formatRunDuration, formatNextCursorHint } from "../util/output";
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
    status: cmd.option({
      long: "status",
      description:
        "Filter sandboxes by status. Options: running, stopping, stopped. Cannot be combined with --all.",
      type: cmd.optional(
        cmd.oneOf(["running", "stopping", "stopped"] as const),
      ),
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
    limit: cmd.option({
      long: "limit",
      description: "Maximum number of sandboxes per page (default 50).",
      type: cmd.optional(cmd.number),
    }),
    cursor: cmd.option({
      long: "cursor",
      description: "Pagination cursor from a previous 'More results' hint.",
      type: cmd.optional(cmd.string),
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, all, status, namePrefix, sortBy, sortOrder, tags, limit, cursor }) {
    if (namePrefix) {
      if (sortBy && sortBy !== "name") {
        console.error(chalk.red("Error: --sort-by must be 'name' when using --name-prefix"));
        return;
      }

      sortBy = 'name';
    }

    if (all && status) {
      console.error(chalk.red("Error: --status cannot be combined with --all"));
      return;
    }

    // The API status filter is only valid with sortBy=createdAt and without
    // tags. Passing --name-prefix forces sortBy=name (set above).
    const hasStatusConflict =
      Object.keys(tags).length > 0 ||
      namePrefix !== undefined ||
      (sortBy !== undefined && sortBy !== "createdAt");

    if (status && hasStatusConflict) {
      console.error(chalk.red("Error: --status cannot be combined with --tag, --name-prefix, or a --sort-by other than 'createdAt'"));
      return;
    }

    const requestedStatus = status ?? "running";
    const statusFilter = all ? undefined : requestedStatus;
    const apiStatusApplied = statusFilter !== undefined && !hasStatusConflict;

    const { sandboxes, pagination } = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching sandboxes...").start(),
        (s) => s.stop(),
      );

      return sandboxClient.list({
        token,
        teamId: team,
        projectId: project,
        limit: limit ?? 50,
        ...(cursor && { cursor }),
        ...(namePrefix && { namePrefix }),
        ...(sortBy && { sortBy }),
        ...(sortOrder && { sortOrder }),
        ...(Object.keys(tags).length > 0 && { tags }),
        ...(apiStatusApplied && { status: statusFilter }),
      });
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
        // Prefer the live deadline (`expiresAt`) of the running session. Fall
        // back to the configured timeout for non-running sandboxes that don't
        // report `expiresAt`.
        value: (s) => {
          if (s.expiresAt != null) return timeAgo(s.expiresAt);
          if (s.timeout != null) return timeAgo(s.createdAt + s.timeout);
          return "-";
        },
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

    if (pagination.next !== null) {
      console.log(formatNextCursorHint(pagination.next));
    }
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
