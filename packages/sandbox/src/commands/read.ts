import * as cmd from "cmd-ts";
import chalk from "chalk";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import { sandboxName } from "../args/sandbox-name";
import { output } from "../util/output";

export const read = cmd.command({
  name: "read",
  description: "Print a file from a sandbox to stdout.",
  aliases: ["cat"],
  args: {
    sandbox: cmd.positional({ type: sandboxName }),
    path: cmd.positional({
      displayName: "path",
      description: "The path of the file to read",
    }),
    scope,
  },
  async handler({ sandbox: name, path: filePath, scope }) {
    const sandbox = await sandboxClient.get({
      name,
      teamId: scope.team,
      token: scope.token,
      projectId: scope.project,
    });
    const stream = await sandbox.readFile({ path: filePath });
    if (!stream) {
      process.exitCode = 1;
      output.error(
        [
          `File not found: ${filePath} in sandbox ${name}.`,
          `${chalk.bold("hint:")} List the directory with \`sandbox exec ${name} -- ls ${path.posix.dirname(filePath)}\`.`,
        ].join("\n"),
      );
      return;
    }
    await pipeline(stream, process.stdout, { end: false });
  },
});
