import * as cmd from "cmd-ts";
import { subcommands } from "cmd-ts";
import chalk, { type ChalkInstance } from "chalk";
import ora from "ora";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { acquireRelease } from "../util/disposables";
import { table, timeAgo, formatRunDuration } from "../util/output";
import type { Sandbox } from "@vercel/sandbox";

const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List sessions from a sandbox",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "sandbox name to list sessions for",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, sandbox: name }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    const sessionData = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching sessions...").start(),
        (s) => s.stop(),
      );
      return sandbox.listSessions();
    })();

    const sessions = sessionData.json.sandboxes;

    console.log(
      table({
        rows: sessions,
        columns: {
          ID: { value: (s) => s.id },
          STATUS: {
            value: (s) => s.status,
            color: (s) => SessionStatusColor[s.status] ?? chalk.reset,
          },
          CREATED: { value: (s) => timeAgo(s.createdAt) },
          MEMORY: { value: (s) => s.memory },
          VCPUS: { value: (s) => s.vcpus },
          RUNTIME: { value: (s) => s.runtime },
          TIMEOUT: {
            value: (s) => timeAgo(s.createdAt + s.timeout),
          },
          DURATION: {
            value: (s) => s.duration ? formatRunDuration(s.duration) : "-",
          },
        },
      }),
    );
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
