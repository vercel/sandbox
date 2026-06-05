import * as cmd from "cmd-ts";
import { subcommands } from "cmd-ts";
import { Listr } from "listr2";
import chalk from "chalk";
import ora from "ora";
import type { Drive } from "@vercel/sandbox";
import { scope } from "../args/scope";
import { driveMaxSize, driveName } from "../args/drive";
import { driveClient } from "../client";
import { acquireRelease } from "../util/disposables";
import { formatBytes, formatNextCursorHint, table, timeAgo } from "../util/output";

const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List drives for the specified account and project.",
  args: {
    scope,
    namePrefix: cmd.option({
      long: "name-prefix",
      description: "Filter drives by name prefix.",
      type: cmd.optional(cmd.string),
    }),
    sortOrder: cmd.option({
      long: "sort-order",
      description: "Sort order. Options: asc, desc (default).",
      type: cmd.optional(cmd.oneOf(["asc", "desc"] as const)),
    }),
    limit: cmd.option({
      long: "limit",
      description: "Maximum number of drives per page (default 50).",
      type: cmd.optional(cmd.number),
    }),
    cursor: cmd.option({
      long: "cursor",
      description: "Pagination cursor from a previous 'More results' hint.",
      type: cmd.optional(cmd.string),
    }),
  },
  async handler({
    scope: { token, team, project },
    namePrefix,
    sortOrder,
    limit,
    cursor,
  }) {
    const { drives, pagination } = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching drives...").start(),
        (s) => s.stop(),
      );

      return driveClient.list({
        token,
        teamId: team,
        projectId: project,
        limit: limit ?? 50,
        ...(cursor && { cursor }),
        ...(namePrefix && { namePrefix, sortBy: "name" as const }),
        ...(sortOrder && { sortOrder }),
      });
    })();

    printDrives(drives);

    if (pagination.next !== null) {
      console.log(formatNextCursorHint(pagination.next));
    }
  },
});

const getOrCreate = cmd.command({
  name: "get-or-create",
  description: "Create a drive if it does not already exist, or retrieve it.",
  args: {
    name: cmd.positional({
      type: driveName,
      description: "Drive name to create or retrieve",
    }),
    maxSize: cmd.option({
      long: "max-size",
      description: "Maximum drive size in bytes. If omitted, a default of 100 GiB is used.",
      type: cmd.optional(driveMaxSize),
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, name, maxSize }) {
    const drive = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Creating drive...").start(),
        (s) => s.stop(),
      );

      return driveClient.getOrCreate({
        token,
        teamId: team,
        projectId: project,
        name,
        maxSize,
      });
    })();

    process.stderr.write("✅ Drive " + chalk.cyan(drive.name) + " ready.\n");
    process.stderr.write(
      chalk.dim("   │ ") +
        "max size: " +
        chalk.cyan(formatDriveSize(drive)) +
        "\n",
    );
    process.stderr.write(
      chalk.dim("   ╰ ") +
        "created: " +
        chalk.cyan(timeAgo(drive.createdAt)) +
        "\n",
    );
  },
});

const remove = cmd.command({
  name: "delete",
  aliases: ["rm", "remove"],
  description: "Delete one or more drives.",
  args: {
    name: cmd.positional({
      type: driveName,
      description: "Drive name to delete",
    }),
    names: cmd.restPositionals({
      type: driveName,
      description: "More drive names to delete",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, name, names }) {
    const tasks = Array.from(new Set([name, ...names]), (driveName) => {
      return {
        title: `Deleting drive ${driveName}`,
        async task() {
          const drive = await getDriveByName({
            token,
            teamId: team,
            projectId: project,
            name: driveName,
          });

          if (drive.currentSandboxName || drive.currentSessionId) {
            throw new Error(
              `Drive ${driveName} is attached to a sandbox and cannot be deleted.`,
            );
          }

          await driveClient.delete(drive);
        },
      };
    });

    try {
      await new Listr(tasks, { concurrent: true }).run();
    } catch {
      // Listr already rendered the error; just set exit code.
      process.exitCode = 1;
    }
  },
});

export const drives = subcommands({
  name: "drives",
  description: "Manage sandbox drives",
  cmds: {
    list,
    "get-or-create": getOrCreate,
    delete: remove,
  },
});

function printDrives(drives: Drive[]) {
  console.log(
    table({
      rows: drives,
      columns: {
        NAME: { value: (v) => v.name },
        CREATED: { value: (v) => timeAgo(v.createdAt) },
        UPDATED: { value: (v) => timeAgo(v.updatedAt) },
        SIZE: { value: formatDriveSize },
        ["ATTACHED SANDBOX"]: { value: (v) => v.currentSandboxName ?? "-" },
        ["ATTACHED SESSION"]: { value: (v) => v.currentSessionId ?? "-" },
      },
    }),
  );
}

function formatDriveSize(drive: Drive): string {
  return drive.maxSize === undefined ? "-" : formatBytes(drive.maxSize);
}

async function getDriveByName({
  token,
  teamId,
  projectId,
  name,
}: {
  token: string;
  teamId: string;
  projectId: string;
  name: string;
}): Promise<Drive> {
  const { drives } = await driveClient.list({
    token,
    teamId,
    projectId,
    namePrefix: name,
    sortBy: "name",
    sortOrder: "asc",
    limit: 50,
  });
  const drive = drives.find((drive) => drive.name === name);

  if (!drive) {
    throw new Error(
      [
        `Drive ${name} was not found.`,
        `${chalk.bold("hint:")} Create it with: sandbox drives get-or-create ${name}`,
      ].join("\n"),
    );
  }

  return drive;
}
