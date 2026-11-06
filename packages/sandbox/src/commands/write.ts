import * as cmd from "cmd-ts";
import chalk from "chalk";
import consume from "node:stream/consumers";
import { isatty } from "node:tty";
import { sandboxClient } from "../client";
import { scope } from "../args/scope";
import { sandboxName } from "../args/sandbox-name";
import { output } from "../util/output";
import { parseFileMode } from "../util/file-transfer";

const fileMode = cmd.extendType(cmd.string, {
  displayName: "mode",
  from: async (input) => parseFileMode(input),
});

export const write = cmd.command({
  name: "write",
  description: "Write stdin to a file in a sandbox, replacing it if it exists.",
  args: {
    sandbox: cmd.positional({ type: sandboxName }),
    path: cmd.positional({
      displayName: "path",
      description: "The path of the file to write",
    }),
    mode: cmd.option({
      long: "mode",
      short: "m",
      description: "Octal file permissions, e.g. 755 for an executable script",
      type: cmd.optional(fileMode),
    }),
    scope,
  },
  examples: [
    {
      description: "Write a file from a heredoc",
      command: `sandbox write my-sandbox /vercel/sandbox/hello.js <<'EOF'\nconsole.log("hello");\nEOF`,
    },
    {
      description: "Upload a local file",
      command: `sandbox write my-sandbox /vercel/sandbox/app.js < ./app.js`,
    },
  ],
  async handler({ sandbox: name, path, mode, scope }) {
    if (isatty(0)) {
      process.exitCode = 1;
      output.error(
        [
          `Nothing to write: \`sandbox write\` reads the file contents from stdin.`,
          `${chalk.bold("hint:")} Pipe or redirect content in, e.g. \`echo hello | sandbox write ${name} ${path}\`.`,
        ].join("\n"),
      );
      return;
    }
    const content = await consume.buffer(process.stdin);
    const sandbox = await sandboxClient.get({
      name,
      teamId: scope.team,
      token: scope.token,
      projectId: scope.project,
    });
    await sandbox.writeFiles([{ path, content, mode }]);
    output.error(`Wrote ${content.byteLength} bytes to ${path} in ${name}`);
  },
});
