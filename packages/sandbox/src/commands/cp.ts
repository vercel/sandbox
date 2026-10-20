import { sandboxClient } from "../client";
import * as cmd from "cmd-ts";
import { sandboxName } from "../args/sandbox-name";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { scope } from "../args/scope";
import consume from "node:stream/consumers";
import ora from "ora";
import chalk from "chalk";
import {
  batchBySize,
  listLocalEntries,
  mapWithConcurrency,
  parseFindEntries,
} from "../util/file-transfer";

/** Upload batches of at most this many bytes per request. */
const UPLOAD_BATCH_BYTES = 32 * 1024 * 1024;
/** Read at most this many local files at once. */
const UPLOAD_READ_CONCURRENCY = 8;
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
    return {
      type: "remote",
      sandboxName: await sandboxName.from(id),
      path,
    } as const;
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

    const localSourceStat =
      source.type === "local"
        ? await fs.lstat(source.path).catch(() => null)
        : null;
    if (source.type === "local") {
      const stat = localSourceStat;
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
        await uploadDirectory(
          source.path,
          dest,
          await getSandbox(dest.sandboxName),
        );
        return;
      } else if (recursive && stat?.isSymbolicLink()) {
        if (dest.type !== "remote") {
          throw new Error("Copying between two local paths is not supported.");
        }
        await uploadSymlink(
          source.path,
          dest,
          await getSandbox(dest.sandboxName),
        );
        return;
      }
    } else if (recursive && dest.type === "local") {
      const sandbox = await getSandbox(source.sandboxName);
      await downloadRecursive(source, dest.path, sandbox);
      return;
    }

    const spinner = ora({
      text: `Reading source file (${source.path})...`,
    }).start();
    let sourceFile: Buffer<ArrayBufferLike> | null = null;

    if (source.type === "local") {
      sourceFile = await fs.readFile(source.path).catch((err) => {
        if (err.code === "ENOENT") {
          return null;
        }
        throw err;
      });
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
      await sandbox.writeFiles([
        {
          path: dest.path,
          content: sourceFile,
          mode:
            recursive && localSourceStat?.isFile()
              ? localSourceStat.mode & 0o777
              : undefined,
        },
      ]);
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
  const root = await fs.lstat(localDir);
  const entries = await listLocalEntries(localDir);
  const directories = entries.filter((entry) => entry.type === "directory");
  const symlinks = entries.filter((entry) => entry.type === "symlink");
  const files = entries.filter((entry) => entry.type === "file");

  await sandbox.fs.mkdir(dest.path, { recursive: true });
  for (const directory of directories) {
    await sandbox.fs.mkdir(path.posix.join(dest.path, directory.rel), {
      recursive: true,
    });
  }

  let done = 0;
  for (const batch of batchBySize(files, UPLOAD_BATCH_BYTES)) {
    spinner.text = `Uploading ${done}/${entries.length} entries to ${dest.sandboxName}:${dest.path}...`;
    const contents = await mapWithConcurrency(
      batch,
      UPLOAD_READ_CONCURRENCY,
      async (file) => ({
        path: path.posix.join(dest.path, file.rel),
        content: await fs.readFile(file.abs),
        mode: file.mode,
      }),
    );
    await sandbox.writeFiles(contents);
    done += batch.length;
  }

  for (const symlink of symlinks) {
    await sandbox.fs.symlink(
      symlink.target,
      path.posix.join(dest.path, symlink.rel),
    );
    done += 1;
  }

  // Apply directory modes after writing children so restrictive source modes
  // do not prevent the transfer itself.
  for (const directory of [...directories].sort(
    (a, b) => b.rel.split("/").length - a.rel.split("/").length,
  )) {
    await sandbox.fs.chmod(
      path.posix.join(dest.path, directory.rel),
      directory.mode,
    );
  }
  await sandbox.fs.chmod(dest.path, root.mode & 0o777);

  spinner.succeed(
    `Copied ${entries.length} entries from ${localDir} to ${dest.sandboxName}:${dest.path}`,
  );
}

async function uploadSymlink(
  localPath: string,
  dest: RemotePath,
  sandbox: SandboxHandle,
) {
  const target = await fs.readlink(localPath);
  await sandbox.fs.mkdir(path.posix.dirname(dest.path), { recursive: true });
  await sandbox.fs.symlink(target, dest.path);
  ora().succeed(`Copied ${localPath} to ${dest.sandboxName}:${dest.path}`);
}

/** Download a remote file tree without dereferencing symbolic links. */
async function downloadRecursive(
  source: RemotePath,
  localDir: string,
  sandbox: SandboxHandle,
): Promise<void> {
  const spinner = ora({
    text: `Scanning ${source.sandboxName}:${source.path}...`,
  }).start();
  const result = await sandbox.runCommand("find", [
    source.path,
    "-printf",
    "%y\\0%P\\0%m\\0%l\\0",
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
    return;
  }

  const entries = parseFindEntries(await result.stdout());
  const root = entries.find((entry) => entry.rel === "");
  if (!root) {
    process.exitCode = 1;
    spinner.fail(
      `Could not inspect ${source.path} in sandbox ${source.sandboxName}.`,
    );
    return;
  }

  if (root.type === "file") {
    const content = await sandbox.readFileToBuffer({ path: source.path });
    if (content === null)
      throw new Error(`File disappeared while copying: ${source.path}`);
    await fs.mkdir(path.dirname(localDir), { recursive: true });
    await writeLocalFile(localDir, content, root.mode);
    spinner.succeed(`Copied ${source.path} to ${localDir}`);
    return;
  }
  if (root.type === "symlink") {
    await fs.mkdir(path.dirname(localDir), { recursive: true });
    await fs.symlink(root.target, localDir);
    spinner.succeed(`Copied ${source.path} to ${localDir}`);
    return;
  }

  const children = entries.filter((entry) => entry.rel !== "");
  const directories = children.filter((entry) => entry.type === "directory");
  const symlinks = children.filter((entry) => entry.type === "symlink");
  const files = children.filter((entry) => entry.type === "file");
  await ensureLocalDirectory(localDir, "");
  for (const directory of [...directories].sort(
    (a, b) => a.rel.split("/").length - b.rel.split("/").length,
  )) {
    await ensureLocalDirectory(localDir, directory.rel);
  }
  for (const symlink of symlinks) {
    const target = localTarget(localDir, symlink.rel);
    await ensureLocalDirectory(localDir, parentRel(symlink.rel));
    await fs.symlink(symlink.target, target);
  }

  let done = 0;
  await mapWithConcurrency(files, DOWNLOAD_CONCURRENCY, async (file) => {
    const content = await sandbox.readFileToBuffer({
      path: path.posix.join(source.path, file.rel),
    });
    if (content === null) {
      throw new Error(
        `File disappeared while copying: ${source.path}/${file.rel}`,
      );
    }
    const target = localTarget(localDir, file.rel);
    await ensureLocalDirectory(localDir, parentRel(file.rel));
    await writeLocalFile(target, content, file.mode);
    done += 1;
    spinner.text = `Downloading ${done}/${files.length} files...`;
  });

  for (const directory of [...directories].sort(
    (a, b) => b.rel.split("/").length - a.rel.split("/").length,
  )) {
    await chmodLocalDirectory(localDir, directory.rel, directory.mode);
  }
  await chmodLocalDirectory(localDir, "", root.mode);

  spinner.succeed(
    `Copied ${children.length} entries from ${source.sandboxName}:${source.path} to ${localDir}`,
  );
}

function localTarget(root: string, rel: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(root, ...rel.split("/"));
  if (
    target !== resolvedRoot &&
    !target.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Invalid relative path returned by sandbox: ${rel}`);
  }
  return target;
}

function parentRel(rel: string): string {
  const parts = rel.split("/");
  parts.pop();
  return parts.join("/");
}

/** Create a destination directory while rejecting symlinks below the copy root. */
async function ensureLocalDirectory(
  root: string,
  rel: string,
): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const target = localTarget(root, rel);
  await fs.mkdir(path.dirname(resolvedRoot), { recursive: true });
  const relative = path.relative(resolvedRoot, target);
  const parts = relative === "" ? [] : relative.split(path.sep);
  let current = resolvedRoot;
  for (let index = -1; index < parts.length; index += 1) {
    if (index >= 0) current = path.join(current, parts[index]!);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) {
      throw new Error(`Refusing to copy through symbolic link: ${current}`);
    }
    if (stat && !stat.isDirectory()) {
      throw new Error(`Copy destination is not a directory: ${current}`);
    }
    if (!stat) {
      await fs.mkdir(current).catch(async (error) => {
        if (error.code !== "EEXIST") throw error;
        const racedStat = await fs.lstat(current);
        if (racedStat.isSymbolicLink()) {
          throw new Error(`Refusing to copy through symbolic link: ${current}`);
        }
        if (!racedStat.isDirectory()) throw error;
      });
    }
  }
  return target;
}

/** Write through a file descriptor so the final path cannot be a symlink. */
async function writeLocalFile(
  target: string,
  content: Uint8Array,
  mode: number,
): Promise<void> {
  const handle = await fs.open(
    target,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_TRUNC |
      fsConstants.O_NOFOLLOW,
    mode,
  );
  try {
    await handle.writeFile(content);
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
}

async function chmodLocalDirectory(
  root: string,
  rel: string,
  mode: number,
): Promise<void> {
  const target = await ensureLocalDirectory(root, rel);
  const handle = await fs.open(
    target,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
}
