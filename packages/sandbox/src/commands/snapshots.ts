import * as cmd from "cmd-ts";
import { subcommands } from "cmd-ts";
import { Listr } from "listr2";
import chalk, { type ChalkInstance } from "chalk";
import ora from "ora";
import { scope } from "../args/scope";
import { sandboxName } from "../args/sandbox-name";
import { snapshotId } from "../args/snapshot-id";
import { sandboxClient, snapshotClient } from "../client";
import { acquireRelease } from "../util/disposables";
import { formatBytes, formatNextCursorHint, table, timeAgo } from "../util/output";
import { renderSnapshotTree } from "../util/snapshot-tree";

const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List snapshots for the specified account and project.",
  args: {
    scope,
    name: cmd.option({
      type: cmd.optional(sandboxName),
      long: "name",
      description: "Filter snapshots by sandbox.",
    }),
    sortOrder: cmd.option({
      long: "sort-order",
      description: "Sort order. Options: asc, desc (default)",
      type: cmd.optional(cmd.oneOf(["asc", "desc"] as const)),
    }),
  },
  async handler({ scope: { token, team, project }, name, sortOrder }) {
    const snapshots = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching snapshots...").start(),
        (s) => s.stop(),
      );
      const { snapshots } = await snapshotClient.list({
        token,
        teamId: team,
        projectId: project,
        name,
        limit: 50,
        ...(sortOrder && { sortOrder }),
      });
      return snapshots;
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
          ["SOURCE SESSION"]: { value: (s) => s.sourceSessionId },
        },
      }),
    );
  },
});

const get = cmd.command({
  name: "get",
  description: "Get details of a snapshot.",
  args: {
    scope,
    snapshotId: cmd.positional({
      type: snapshotId,
      description: "Snapshot ID to retrieve",
    }),
  },
  async handler({ scope: { token, team, project }, snapshotId: id }) {
    const snapshot = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching snapshot...").start(),
        (s) => s.stop(),
      );
      return snapshotClient.get({
        token,
        teamId: team,
        projectId: project,
        snapshotId: id,
      });
    })();

    console.log(
      table({
        rows: [snapshot],
        columns: {
          ID: { value: (s) => s.snapshotId },
          STATUS: {
            value: (s) => s.status,
            color: (s) => SnapshotStatusColor.get(s.status) ?? chalk.reset,
          },
          CREATED: { value: (s) => timeAgo(s.createdAt) },
          EXPIRATION: { value: (s) => s.status === 'deleted' ? chalk.gray.dim('deleted') : timeAgo(s.expiresAt) },
          SIZE: { value: (s) => formatBytes(s.sizeBytes) },
          ["SOURCE SESSION"]: { value: (s) => s.sourceSessionId },
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
      description: "Snapshot ID to delete",
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
    try {
      await new Listr(tasks, { concurrent: true }).run();
    } catch {
      // Listr already rendered the error; just set exit code
      process.exitCode = 1;
    }
  },
});

const tree = cmd.command({
  name: "tree",
  description: "Show the snapshot ancestry tree for a sandbox.",
  args: {
    scope,
    sandboxName: cmd.positional({
      type: sandboxName,
      description: "Sandbox name",
    }),
    limit: cmd.option({
      long: "limit",
      description:
        "Maximum number of snapshots per page and direction (1–10, default 10).",
      type: cmd.optional(cmd.number),
    }),
    cursor: cmd.option({
      long: "cursor",
      description:
        "Pagination cursor from a previous 'More ancestors' or 'More descendants' hint.",
      type: cmd.optional(cmd.string),
    }),
    direction: cmd.option({
      long: "direction",
      description:
        "Pagination direction (default desc). 'desc' = ancestors, 'asc' = descendants. Only used with --cursor.",
      type: cmd.optional(cmd.oneOf(["asc", "desc"] as const)),
    }),
  },
  async handler({
    scope: { token, team, project },
    sandboxName: name,
    limit,
    cursor,
    direction,
  }) {
    if (limit !== undefined && (limit < 1 || limit > 10)) {
      console.error(
        chalk.red("Error: --limit must be between 1 and 10."),
      );
      process.exitCode = 1;
      return;
    }

    const pageLimit = limit ?? 10;

    // Paginated single-direction branch.
    if (cursor) {
      const sortOrder = direction ?? "desc";
      const page = await (async () => {
        using _spinner = acquireRelease(
          () => ora("Fetching snapshot tree...").start(),
          (s) => s.stop(),
        );
        return snapshotClient.tree({
          snapshotId: cursor,
          sortOrder,
          limit: pageLimit,
          token,
          teamId: team,
          projectId: project,
        });
      })();

      const ancestors =
        sortOrder === "desc"
          ? page
          : { snapshots: [], pagination: { count: 0, next: null } };
      const descendants =
        sortOrder === "asc"
          ? page
          : { snapshots: [], pagination: { count: 0, next: null } };

      console.log(
        renderSnapshotTree({
          currentSnapshotId: "",
          hideCurrent: true,
          ancestors,
          descendants,
        }),
      );

      if (page.pagination.next !== null) {
        console.log(
          formatNextCursorHint(
            "sandbox snapshots tree",
            { direction: sortOrder, limit },
            page.pagination.next,
            [name],
            sortOrder === "desc" ? "More ancestors" : "More descendants",
          ),
        );
      }
      return;
    }

    // Default: bidirectional view anchored on the sandbox's current snapshot.
    const result = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching snapshot tree...").start(),
        (s) => s.stop(),
      );

      const sandbox = await sandboxClient.get({
        name,
        token,
        teamId: team,
        projectId: project,
      });

      const currentSnapshotId = sandbox.currentSnapshotId;
      if (!currentSnapshotId) {
        return null;
      }

      const [currentSnap, ancestors, descendants] = await Promise.all([
        snapshotClient.get({
          snapshotId: currentSnapshotId,
          token,
          teamId: team,
          projectId: project,
        }),
        snapshotClient.tree({
          snapshotId: currentSnapshotId,
          sortOrder: "desc",
          limit: pageLimit,
          token,
          teamId: team,
          projectId: project,
        }),
        snapshotClient.tree({
          snapshotId: currentSnapshotId,
          sortOrder: "asc",
          limit: pageLimit,
          token,
          teamId: team,
          projectId: project,
        }),
      ]);

      return {
        currentSnap,
        currentSnapshotId,
        ancestors,
        descendants,
      };
    })();

    if (!result) {
      console.log(chalk.yellow("No snapshots found for this sandbox."));
      return;
    }

    console.log(
      renderSnapshotTree({
        currentSnapshotId: result.currentSnapshotId,
        currentSnapshotExpiresAt: result.currentSnap.expiresAt?.getTime(),
        ancestors: result.ancestors,
        descendants: result.descendants,
      }),
    );

    if (result.ancestors.pagination.next !== null) {
      console.log(
        formatNextCursorHint(
          "sandbox snapshots tree",
          { direction: "desc", limit },
          result.ancestors.pagination.next,
          [name],
          "More ancestors",
        ),
      );
    }
    if (result.descendants.pagination.next !== null) {
      console.log(
        formatNextCursorHint(
          "sandbox snapshots tree",
          { direction: "asc", limit },
          result.descendants.pagination.next,
          [name],
          "More descendants",
        ),
      );
    }
  },
});

export const snapshots = subcommands({
  name: "snapshots",
  description: "Manage sandbox snapshots",
  cmds: {
    list,
    get,
    tree,
    delete: remove,
  },
});

const SnapshotStatusColor = new Map<string, ChalkInstance>([
  ["created", chalk.cyan],
  ["deleted", chalk.gray.dim],
  ["failed", chalk.red],
]);
