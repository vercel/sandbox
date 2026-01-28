import * as cmd from "cmd-ts";
import { Sandbox } from "@vercel/sandbox";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import chalk, { ChalkInstance } from "chalk";
import ora from "ora";
import { acquireRelease } from "../util/disposables";
import { table, timeAgo } from "../util/output";
import createDebugger from "debug";

const VALID_STATUSES = [
  "pending",
  "running",
  "stopping",
  "stopped",
  "failed",
  "snapshotting",
] as const;

const ValidStatus = cmd.oneOf(VALID_STATUSES);

type NotReadonly<T> = {
  -readonly [P in keyof T]: T[P];
};

const debug = createDebugger("sandbox:list");

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
    statuses: cmd.multioption({
      long: "status",
      short: "s",
      type: cmd.array(ValidStatus),
      defaultValue(): NotReadonly<(typeof VALID_STATUSES)[number][]> {
        return ["pending", "running", "snapshotting", "stopping"];
      },
      description: `Filter by status: ${VALID_STATUSES.join(", ")}`,
    }),
  },
  async handler({ scope: { token, team, project }, all, statuses }) {
    const sandboxes = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching sandboxes...").start(),
        (s) => s.stop(),
      );

      const status = all ? undefined : statuses.join(",");
      debug("Fetching sandboxes with status:", status ?? "all");

      const { json } = await sandboxClient.list({
        token,
        teamId: team,
        projectId: project,
        limit: 100,
        status,
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
