import { sandboxClient } from "../client";
import * as cmd from "cmd-ts";
import { sandboxId } from "../args/sandbox-id";
import * as Fs from "cmd-ts/batteries/fs";
import fs from "node:fs/promises";
import path from "node:path";
import { scope } from "../args/scope";
import consume from "node:stream/consumers";
import ora from "ora";
import chalk from "chalk";

export const args = {} as const;

const localOrRemote = cmd.extendType(cmd.string, {
  async from(input) {
    const parts = input.split(":");
    if (parts.length === 2) {
      const [id, path] = parts;
      if (!id || !path) {
        throw new Error(
          [
            `Invalid copy path format: "${input}".`,
            `${chalk.bold("hint:")} Expected format: SANDBOX_ID:PATH (e.g., sbx_abc123:/home/user/file.txt).`,
            "╰▶ Local paths should not contain colons.",
          ].join("\n"),
        );
      }
      return { type: "remote", id: await sandboxId.from(id), path } as const;
    }

    const file = await Fs.File.from(input);
    return { type: "local", file } as const;
  },
});

export const cp = cmd.command({
  name: "copy",
  description: "Copy files between your local filesystem and a remote sandbox",
  aliases: ["cp"],
  args: {
    source: cmd.positional({
      displayName: `src`,
      description: `The source file to copy from local file system, or or a sandbox_id:path from a remote sandbox`,
      type: localOrRemote,
    }),
    dest: cmd.positional({
      displayName: `dst`,
      description: `The destination file to copy to local file system, or or a sandbox_id:path to a remote sandbox`,
      type: localOrRemote,
    }),
    scope,
  },
  async handler({ scope, source, dest }) {
    const spinner = ora({ text: "reading file..." }).start();
    const sourceFile =
      source.type === "local"
        ? await fs.readFile(source.file)
        : await (async (src) => {
            const sandbox = await sandboxClient.get({
              sandboxId: src.id,
              teamId: scope.team,
              token: scope.token,
              projectId: scope.project,
            });
            const file = await sandbox.readFile({ path: src.path });
            if (!file) {
              return null;
            }
            return consume.buffer(file);
          })(source);

    if (!sourceFile) {
      if (source.type === "remote") {
        const dir = path.dirname(source.path);
        spinner.fail(
          [
            `File not found: ${source.path} in sandbox ${source.id}.`,
            `${chalk.bold("hint:")} Verify the file path exists using \`sandbox exec ${source.id} ls ${dir}\`.`,
          ].join("\n"),
        );
      } else {
        spinner.fail("file not found");
      }
      return;
    }

    spinner.text = "writing file...";

    if (dest.type === "local") {
      await fs.writeFile(dest.file, sourceFile);
    } else {
      const sandbox = await sandboxClient.get({
        sandboxId: dest.id,
        teamId: scope.team,
        projectId: scope.project,
        token: scope.token,
      });
      await sandbox.writeFiles([{ path: dest.path, content: sourceFile }]);
    }

    spinner.succeed("copied successfully!");
  },
});
