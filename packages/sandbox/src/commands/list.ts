import * as cmd from "cmd-ts";
import { Sandbox } from "@vercel/sandbox";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import chalk, { ChalkInstance } from "chalk";
import ora from "ora";
import { acquireRelease } from "../util/disposables";
import { table, timeAgo } from "../util/output";

const VALID_STATUSES = [
  "pending",
  "running",
  "stopping",
  "stopped",
  "failed",
  "snapshotting",
] as const;

const DEFAULT_STATUSES = ["pending", "running", "snapshotting", "stopping"];

export const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List all sandboxes for the specified account and project.",
  args: {
    scope,
    all: cmd.flag({
      long: "all",
      short: "a",
      description: "Show all sandboxes including stopped and failed",
    }),
    status: cmd.multioption({
      long: "status",
      short: "s",
      type: cmd.array(cmd.string),
      description: `Filter by status: ${VALID_STATUSES.join(", ")}`,
    }),
  },
  async handler({ scope: { token, team, project }, all, status }) {
    const statusFilter = (() => {
      if (status.length > 0) {
        const statuses = status
          .flatMap((s) => s.split(","))
          .map((s) => s.trim().toLowerCase());
        const invalid = statuses.filter(
          (s) => !VALID_STATUSES.includes(s as (typeof VALID_STATUSES)[number]),
        );
        if (invalid.length > 0) {
          console.error(
            `Invalid status: ${invalid.join(", ")}. Valid values: ${VALID_STATUSES.join(", ")}`,
          );
          process.exit(1);
        }
        return statuses.join(",");
      }
      if (all) return undefined;
      return DEFAULT_STATUSES.join(",");
    })();

    const sandboxes = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching sandboxes...").start(),
        (s) => s.stop(),
      );

      const { json } = await sandboxClient.list({
        token,
        teamId: team,
        projectId: project,
        limit: 100,
        status: statusFilter,
      });

      return json.sandboxes;
    })();

    const memoryFormatter = new Intl.NumberFormat(undefined, {
      style: "unit",
      unit: "megabyte",
    });

    console.log(
      table({
        rows: sandboxes,
        columns: {
          ID: { value: (s) => s.id },
          STATUS: {
            value: (s) => s.status,
            color: (s) => SandboxStatusColor.get(s.status) ?? chalk.reset,
          },
          CREATED: {
            value: (s) => timeAgo(s.createdAt),
          },
          MEMORY: { value: (s) => memoryFormatter.format(s.memory) },
          VCPUS: { value: (s) => s.vcpus },
          RUNTIME: { value: (s) => s.runtime },
          TIMEOUT: {
            value: (s) => timeAgo(s.createdAt + s.timeout),
          },
          SNAPSHOT: {
            value: (s) => s.sourceSnapshotId ?? "-",
          },
        },
      }),
    );
  },
});

const SandboxStatusColor = new Map<Sandbox["status"], ChalkInstance>([
  ["running", chalk.cyan],
  ["failed", chalk.red],
  ["stopped", chalk.gray.dim],
  ["stopping", chalk.gray],
  ["pending", chalk.magenta],
]);
