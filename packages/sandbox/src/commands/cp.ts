import { sandboxClient } from "../client";
import * as cmd from "cmd-ts";
import { sandboxName } from "../args/sandbox-name";
import fs from "node:fs/promises";
import path from "node:path";
import { scope } from "../args/scope";
import consume from "node:stream/consumers";
import ora from "ora";
import chalk from "chalk";
import {
  batchBySize,
  listLocalFiles,
  mapWithConcurrency,
  parseFindOutput,
} from "../util/file-transfer";

/** Upload batches of at most this many bytes per request. */
const UPLOAD_BATCH_BYTES = 32 * 1024 * 1024;
/** Download at most this many files at once. */
const DOWNLOAD_CONCURRENCY = 8;

export const args = {} as const;

export const parseLocalOrRemotePath = async (input: string) => {
  const parts = input.split(":");
  if (parts.length === 2) {
    const [id, path] = parts;
    if (!id || !path) {
      throw new Error(
        [
          `Invalid copy path format: "${input}".`,
          `${chalk.bold("hint:")} Expected format: SANDBOX_NAME:PATH (e.g., my-sandbox:/home/user/file.txt).`,
          "╰▶ Local paths should not contain colons.",
        ].join("\n"),
      );
    }
    return { type: "remote", sandboxName: await sandboxName.from(id), path } as const;
  }

  return { type: "local", path: input } as const;
};

type CopyPath = Awaited<ReturnType<typeof parseLocalOrRemotePath>>;
type RemotePath = Extract<CopyPath, { type: "remote" }>;

/** Parse a `SANDBOX_NAME:PATH` argument, rejecting local paths. */
export const parseRemotePath = async (input: string): Promise<RemotePath> => {
  const parsed = await parseLocalOrRemotePath(input);
  if (parsed.type !== "remote") {
    throw new Error(
      [
        `Expected a sandbox path, got "${input}".`,
        `${chalk.bold("hint:")} Use the format SANDBOX_NAME:PATH (e.g., my-sandbox:/vercel/sandbox/file.txt).`,
      ].join("\n"),
    );
  }
  return parsed;
};

export const remotePath = cmd.extendType(cmd.string, {
  displayName: "name:path",
  description: "A file in a sandbox, as SANDBOX_NAME:PATH",
  from: parseRemotePath,
});

const localOrRemote = cmd.extendType(cmd.string, {
  from: parseLocalOrRemotePath,
});

export const cp = cmd.command({
  name: "copy",
  description: "Copy files between your local filesystem and a remote sandbox",
  aliases: ["cp"],
  args: {
    source: cmd.positional({
      displayName: `src`,
      description: `The source file to copy from local file system, or a sandbox_name:path from a remote sandbox`,
      type: localOrRemote,
    }),
    dest: cmd.positional({
      displayName: `dst`,
      description: `The destination file to copy to local file system, or a sandbox_name:path to a remote sandbox`,
      type: localOrRemote,
    }),
    recursive: cmd.flag({
      long: "recursive",
      short: "r",
      description:
        "Copy a directory and everything in it. The contents of src end up inside dst.",
    }),
    scope,
  },
  async handler({ scope, source, dest, recursive }) {
    if (source.type === "remote" && dest.type === "remote") {
      throw new Error(
        [
          `Copying between two sandbox paths is not supported.`,
          `${chalk.bold("hint:")} Copy to your machine first, then copy into the other sandbox.`,
        ].join("\n"),
      );
    }

    const getSandbox = (name: string) =>
      sandboxClient.get({
        name,
        teamId: scope.team,
        token: scope.token,
        projectId: scope.project,
      });

    if (source.type === "local") {
      const stat = await fs.stat(source.path).catch(() => null);
      if (stat?.isDirectory()) {
        if (!recursive) {
          process.exitCode = 1;
          ora().fail(
            [
              `${source.path} is a directory.`,
              `${chalk.bold("hint:")} Pass --recursive (-r) to copy a directory.`,
            ].join("\n"),
          );
          return;
        }
        if (dest.type !== "remote") {
          throw new Error("Copying between two local paths is not supported.");
        }
        await uploadDirectory(source.path, dest, await getSandbox(dest.sandboxName));
        return;
      }
    } else if (recursive && dest.type === "local") {
      const sandbox = await getSandbox(source.sandboxName);
      const copied = await downloadDirectory(source, dest.path, sandbox);
      if (copied) return;
      // The source is a single file: fall through to the regular copy.
    }

    const spinner = ora({ text: `Reading source file (${source.path})...` }).start();
    let sourceFile: Buffer<ArrayBufferLike> | null = null;

    if (source.type === "local") {
      sourceFile = await fs.readFile(source.path).catch((err) => {
        if (err.code === "ENOENT") {
          return null;
        }
        throw err;
      })
    } else {
      const sandbox = await sandboxClient.get({
        name: source.sandboxName,
        teamId: scope.team,
        token: scope.token,
        projectId: scope.project,
      });
      const file = await sandbox.readFile({ path: source.path });
      if (file) {
        sourceFile = await consume.buffer(file);
      }
    }

    if (!sourceFile) {
      process.exitCode = 1;
      if (source.type === "remote") {
        const dir = path.dirname(source.path);
        spinner.fail(
          [
            `File not found: ${source.path} in sandbox ${source.sandboxName}.`,
            `${chalk.bold("hint:")} Verify the file path exists using \`sandbox exec ${source.sandboxName} ls ${dir}\`.`,
            `╰▶ To copy a directory, pass --recursive (-r).`,
          ].join("\n"),
        );
      } else {
        spinner.fail(`Source file (${source.path}) not found.`);
      }
      return;
    }

    spinner.text = `Writing to destination file (${dest.path})...`;

    if (dest.type === "local") {
      await fs.writeFile(dest.path, sourceFile);
    } else {
      const sandbox = await sandboxClient.get({
        name: dest.sandboxName,
        teamId: scope.team,
        projectId: scope.project,
        token: scope.token,
      });
      await sandbox.writeFiles([{ path: dest.path, content: sourceFile }]);
    }

    spinner.succeed(`Copied ${source.path} to ${dest.path} successfully!`);
  },
});

type SandboxHandle = Awaited<ReturnType<typeof sandboxClient.get>>;

async function uploadDirectory(
  localDir: string,
  dest: RemotePath,
  sandbox: SandboxHandle,
) {
  const spinner = ora({ text: `Scanning ${localDir}...` }).start();
  const files = await listLocalFiles(localDir);
  if (files.length === 0) {
    await sandbox.mkDir(dest.path).catch(() => {});
    spinner.succeed(`${localDir} is empty, nothing to copy.`);
    return;
  }

  let done = 0;
  for (const batch of batchBySize(files, UPLOAD_BATCH_BYTES)) {
    spinner.text = `Uploading ${done}/${files.length} files to ${dest.sandboxName}:${dest.path}...`;
    const contents = await Promise.all(
      batch.map(async (file) => ({
        path: path.posix.join(dest.path, file.rel),
        content: await fs.readFile(file.abs),
        mode: file.mode,
      })),
    );
    await sandbox.writeFiles(contents);
    done += batch.length;
  }

  spinner.succeed(
    `Copied ${files.length} files from ${localDir} to ${dest.sandboxName}:${dest.path}`,
  );
}

/**
 * Download every file under a sandbox directory into `localDir`.
 * Returns false when the source turns out to be a single file.
 */
async function downloadDirectory(
  source: RemotePath,
  localDir: string,
  sandbox: SandboxHandle,
): Promise<boolean> {
  const spinner = ora({ text: `Scanning ${source.sandboxName}:${source.path}...` }).start();
  const result = await sandbox.runCommand("find", [
    source.path,
    "-type",
    "f",
    "-printf",
    "%P\\0",
  ]);
  if (result.exitCode !== 0) {
    process.exitCode = 1;
    spinner.fail(
      [
        `Could not list ${source.path} in sandbox ${source.sandboxName}.`,
        (await result.stderr()).trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return true;
  }

  const files = parseFindOutput(await result.stdout());
  if (files.length === 1 && files[0] === "") {
    spinner.stop();
    return false;
  }

  await fs.mkdir(localDir, { recursive: true });
  let done = 0;
  await mapWithConcurrency(files, DOWNLOAD_CONCURRENCY, async (rel) => {
    const content = await sandbox.readFileToBuffer({
      path: path.posix.join(source.path, rel),
    });
    if (content) {
      const target = path.join(localDir, ...rel.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
    done += 1;
    spinner.text = `Downloading ${done}/${files.length} files...`;
  });

  spinner.succeed(
    `Copied ${files.length} files from ${source.sandboxName}:${source.path} to ${localDir}`,
  );
  return true;
}
