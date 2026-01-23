import * as cmd from "cmd-ts";
import { Sandbox } from "@vercel/sandbox";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import chalk, { ChalkInstance } from "chalk";
import { formatDistance } from "date-fns/formatDistance";
import ora from "ora";
import { acquireRelease } from "../util/disposables";

export const list = cmd.command({
  name: "list",
  aliases: ["ls"],
  description: "List all sandboxes for the specified account and project.",
  args: {
    scope,
    all: cmd.flag({
      long: "all",
      short: "a",
      description: "Show all sandboxes (default shows just running)",
    }),
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
            color: (s) => StatusColor.get(s.status) ?? chalk.reset,
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
        },
      }),
    );
  },
});

function timeAgo(date: string | number | Date) {
  return formatDistance(date, new Date(), {
    addSuffix: true,
  })
    .replace("about ", "")
    .replace("less than ", "");
}

function table<T extends object>(opts: {
  rows: T[];
  columns: Record<
    string,
    {
      value: (row: T) => string | number;
      color?: (row: T) => ChalkInstance;
    }
  >;
}) {
  const titles = Object.keys(opts.columns);
  const maxWidths: number[] = titles.map((title) => title.length);
  const data = opts.rows.map((row) => {
    return titles.map((title, i) => {
      let value = String(opts.columns[title].value(row));
      if (value.length > maxWidths[i]) {
        maxWidths[i] = value.length;
      }
      if (opts.columns[title].color) {
        value = opts.columns[title].color(row)(value);
      }
      return value;
    });
  });

  const padded = (t: string, i: number) => t.padEnd(maxWidths[i], " ");

  const space = "   ";

  return [
    chalk.bold(titles.map(padded).join(space)),
    ...data.map((row) => row.map(padded).join(space)),
  ].join("\n");
}

export const StatusColor = new Map<Sandbox["status"], ChalkInstance>([
  ["running", chalk.cyan],
  ["failed", chalk.red],
  ["stopped", chalk.gray.dim],
  ["stopping", chalk.gray],
  ["pending", chalk.magenta],
]);
