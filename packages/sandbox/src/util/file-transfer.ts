import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";

export type LocalFile = { abs: string; rel: string; mode: number; size: number };

/**
 * List every regular file under a local directory, with paths relative to it.
 * Relative paths always use forward slashes so they can be joined onto a
 * sandbox path.
 */
export async function listLocalFiles(root: string): Promise<LocalFile[]> {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files: LocalFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const stat = await fs.stat(abs);
    files.push({
      abs,
      rel: path.relative(root, abs).split(path.sep).join("/"),
      mode: stat.mode & 0o777,
      size: stat.size,
    });
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
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
 * Parse NUL-separated output of `find <dir> -type f -printf '%P\0'` into
 * relative paths. An empty relative path means the source is a single file.
 */
export function parseFindOutput(stdout: string): string[] {
  return stdout.split("\0").filter((_, i, all) => i < all.length - 1);
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
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}
