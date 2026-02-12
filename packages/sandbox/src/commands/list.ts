import * as cmd from "cmd-ts";
import { Sandbox } from "@vercel/sandbox";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import chalk, { ChalkInstance } from "chalk";
import ora from "ora";
import { acquireRelease } from "../util/disposables";
import { table, timeAgo } from "../util/output";

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
    scope,
  },
  async handler({ scope: { token, team, project }, all }) {
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
      });

      let sandboxes = json.sandboxes;

      if (!all) {
        sandboxes = sandboxes.filter((x) => x.status === "running");
      }

      return sandboxes;
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
            color: (s) => SandboxStatusColor[s.status] ?? chalk.reset,
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

const SandboxStatusColor: Record<Sandbox["status"], ChalkInstance> = {
  running: chalk.cyan,
  failed: chalk.red,
  stopped: chalk.gray.dim,
  stopping: chalk.gray,
  pending: chalk.magenta,
  snapshotting: chalk.blue,
  aborted: chalk.gray.dim,
};
