import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";

type LocalEntryBase = {
  abs: string;
  rel: string;
  mode: number;
  size: number;
};

export type LocalEntry =
  | (LocalEntryBase & { type: "file" })
  | (LocalEntryBase & { type: "directory" })
  | (LocalEntryBase & { type: "symlink"; target: string });

export type LocalFile = Extract<LocalEntry, { type: "file" }>;

export type RemoteEntry =
  | { type: "file"; rel: string; mode: number }
  | { type: "directory"; rel: string; mode: number }
  | { type: "symlink"; rel: string; mode: number; target: string };

/**
 * List every regular file, directory, and symbolic link under a local
 * directory. Relative paths use forward slashes so they can be joined onto a
 * sandbox path without changing symlink targets.
 */
export async function listLocalEntries(root: string): Promise<LocalEntry[]> {
  const entries = await fs.readdir(root, {
    recursive: true,
    withFileTypes: true,
  });
  const results: LocalEntry[] = [];
  for (const entry of entries) {
    const abs = path.join(entry.parentPath, entry.name);
    const stat = await fs.lstat(abs);
    const base = {
      abs,
      rel: path.relative(root, abs).split(path.sep).join("/"),
      mode: stat.mode & 0o777,
      size: stat.size,
    };
    if (stat.isFile()) {
      results.push({ ...base, type: "file" });
    } else if (stat.isDirectory()) {
      results.push({ ...base, type: "directory", size: 0 });
    } else if (stat.isSymbolicLink()) {
      results.push({
        ...base,
        type: "symlink",
        size: 0,
        target: await fs.readlink(abs),
      });
    } else {
      throw new Error(`Unsupported file type: ${abs}`);
    }
  }
  return results.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Group files into batches whose total size stays under `maxBytes`, so a large
 * directory upload is split into several tarballs instead of one huge request.
 * A single file larger than `maxBytes` gets its own batch.
 */
export function batchBySize<T extends { size: number }>(
  files: T[],
  maxBytes: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;
  for (const file of files) {
    if (current.length > 0 && currentSize + file.size > maxBytes) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(file);
    currentSize += file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Parse NUL-separated `find` output containing type, relative path, mode, and
 * symlink target fields. The root entry has an empty relative path.
 */
export function parseFindEntries(stdout: string): RemoteEntry[] {
  if (stdout === "") return [];
  const fields = stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 4 !== 0) {
    throw new Error("Invalid file listing returned by sandbox");
  }

  const entries: RemoteEntry[] = [];
  for (let i = 0; i < fields.length; i += 4) {
    const [kind, rel, modeText, target] = fields.slice(i, i + 4) as [
      string,
      string,
      string,
      string,
    ];
    const mode = parseInt(modeText, 8);
    if (!Number.isFinite(mode)) {
      throw new Error(`Invalid file mode returned by sandbox: ${modeText}`);
    }
    if (kind === "f") entries.push({ type: "file", rel, mode });
    else if (kind === "d") entries.push({ type: "directory", rel, mode });
    else if (kind === "l") {
      entries.push({ type: "symlink", rel, mode, target });
    } else {
      throw new Error(`Unsupported remote file type: ${kind}`);
    }
  }
  return entries;
}

/** Parse an octal file mode such as `755` or `0644`. */
export function parseFileMode(input: string): number {
  if (!/^0?[0-7]{3}$/.test(input)) {
    throw new Error(
      [
        `Invalid file mode: "${input}".`,
        `${chalk.bold("hint:")} Use an octal mode such as 644 or 755.`,
      ].join("\n"),
    );
  }
  return parseInt(input, 8);
}

/** Run `fn` over `items` with at most `limit` calls in flight. */
export async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  let next = 0;
  const results = new Array<U>(items.length);
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
