import * as cmd from "cmd-ts";
import { subcommands } from "cmd-ts";
import { Listr } from "listr2";
import chalk from "chalk";
import ora from "ora";
import type { Volume } from "@vercel/sandbox";
import { scope } from "../args/scope";
import { volumeMaxSize, volumeName } from "../args/volume";
import { volumeClient } from "../client";
import { acquireRelease } from "../util/disposables";
import { formatBytes, formatNextCursorHint, table, timeAgo } from "../util/output";

const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List volumes for the specified account and project.",
  args: {
    scope,
    namePrefix: cmd.option({
      long: "name-prefix",
      description: "Filter volumes by name prefix.",
      type: cmd.optional(cmd.string),
    }),
    sortOrder: cmd.option({
      long: "sort-order",
      description: "Sort order. Options: asc, desc (default).",
      type: cmd.optional(cmd.oneOf(["asc", "desc"] as const)),
    }),
    limit: cmd.option({
      long: "limit",
      description: "Maximum number of volumes per page (default 50).",
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
    const { volumes, pagination } = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching volumes...").start(),
        (s) => s.stop(),
      );

      return volumeClient.list({
        token,
        teamId: team,
        projectId: project,
        limit: limit ?? 50,
        ...(cursor && { cursor }),
        ...(namePrefix && { namePrefix, sortBy: "name" as const }),
        ...(sortOrder && { sortOrder }),
      });
    })();

    printVolumes(volumes);

    if (pagination.next !== null) {
      console.log(formatNextCursorHint(pagination.next));
    }
  },
});

const getOrCreate = cmd.command({
  name: "get-or-create",
  description: "Create a volume if it does not already exist, or retrieve it.",
  args: {
    name: cmd.positional({
      type: volumeName,
      description: "Volume name to create or retrieve",
    }),
    maxSize: cmd.option({
      long: "max-size",
      description: "Maximum volume size in bytes. If omitted, a default of 100 GiB is used.",
      type: cmd.optional(volumeMaxSize),
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, name, maxSize }) {
    const volume = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Creating volume...").start(),
        (s) => s.stop(),
      );

      return volumeClient.getOrCreate({
        token,
        teamId: team,
        projectId: project,
        name,
        maxSize,
      });
    })();

    process.stderr.write("✅ Volume " + chalk.cyan(volume.name) + " ready.\n");
    process.stderr.write(
      chalk.dim("   │ ") +
        "max size: " +
        chalk.cyan(formatVolumeSize(volume)) +
        "\n",
    );
    process.stderr.write(
      chalk.dim("   ╰ ") +
        "created: " +
        chalk.cyan(timeAgo(volume.createdAt)) +
        "\n",
    );
  },
});

const remove = cmd.command({
  name: "delete",
  aliases: ["rm", "remove"],
  description: "Delete one or more volumes.",
  args: {
    name: cmd.positional({
      type: volumeName,
      description: "Volume name to delete",
    }),
    names: cmd.restPositionals({
      type: volumeName,
      description: "More volume names to delete",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, name, names }) {
    const tasks = Array.from(new Set([name, ...names]), (volumeName) => {
      return {
        title: `Deleting volume ${volumeName}`,
        async task() {
          const volume = await getVolumeByName({
            token,
            teamId: team,
            projectId: project,
            name: volumeName,
          });

          if (volume.currentSandboxName || volume.currentSessionId) {
            throw new Error(
              `Volume ${volumeName} is attached to a sandbox and cannot be deleted.`,
            );
          }

          await volumeClient.delete(volume);
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

export const volumes = subcommands({
  name: "volumes",
  description: "Manage sandbox volumes",
  cmds: {
    list,
    "get-or-create": getOrCreate,
    delete: remove,
  },
});

function printVolumes(volumes: Volume[]) {
  console.log(
    table({
      rows: volumes,
      columns: {
        NAME: { value: (v) => v.name },
        CREATED: { value: (v) => timeAgo(v.createdAt) },
        UPDATED: { value: (v) => timeAgo(v.updatedAt) },
        SIZE: { value: formatVolumeSize },
        ["ATTACHED SANDBOX"]: { value: (v) => v.currentSandboxName ?? "-" },
        ["ATTACHED SESSION"]: { value: (v) => v.currentSessionId ?? "-" },
      },
    }),
  );
}

function formatVolumeSize(volume: Volume): string {
  return volume.maxSize === undefined ? "-" : formatBytes(volume.maxSize);
}

async function getVolumeByName({
  token,
  teamId,
  projectId,
  name,
}: {
  token: string;
  teamId: string;
  projectId: string;
  name: string;
}): Promise<Volume> {
  const { volumes } = await volumeClient.list({
    token,
    teamId,
    projectId,
    namePrefix: name,
    sortBy: "name",
    sortOrder: "asc",
    limit: 1,
  });
  const volume = volumes[0];

  if (!volume) {
    throw new Error(
      [
        `Volume ${name} was not found.`,
        `${chalk.bold("hint:")} Create it with: sandbox volumes get-or-create ${name}`,
      ].join("\n"),
    );
  }

  return volume;
}
