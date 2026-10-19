import * as cmd from "cmd-ts";
import chalk from "chalk";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import { remotePath } from "./cp";
import { output } from "../util/output";

export const read = cmd.command({
  name: "read",
  description:
    "Print a file from a sandbox to stdout. Raw bytes, nothing else, so the output can be piped.",
  aliases: ["cat"],
  args: {
    file: cmd.positional({
      displayName: "name:path",
      description: "The file to read, as SANDBOX_NAME:PATH",
      type: remotePath,
    }),
    scope,
  },
  async handler({ file, scope }) {
    const sandbox = await sandboxClient.get({
      name: file.sandboxName,
      teamId: scope.team,
      token: scope.token,
      projectId: scope.project,
    });
    const stream = await sandbox.readFile({ path: file.path });
    if (!stream) {
      process.exitCode = 1;
      output.error(
        [
          `File not found: ${file.path} in sandbox ${file.sandboxName}.`,
          `${chalk.bold("hint:")} List the directory with \`sandbox exec ${file.sandboxName} -- ls ${path.posix.dirname(file.path)}\`.`,
        ].join("\n"),
      );
      return;
    }
    await pipeline(stream, process.stdout, { end: false });
  },
});
