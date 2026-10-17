import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  batchBySize,
  listLocalFiles,
  mapWithConcurrency,
  parseFileMode,
  parseFindOutput,
} from "../../src/util/file-transfer";

describe("listLocalFiles", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-cp-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("lists nested files with posix relative paths and modes", async () => {
    await fs.mkdir(path.join(dir, "src", "lib"), { recursive: true });
    await fs.mkdir(path.join(dir, "empty"));
    await fs.writeFile(path.join(dir, "README.md"), "hi");
    await fs.writeFile(path.join(dir, "src", "lib", "a.ts"), "export {}");
    await fs.writeFile(path.join(dir, "run.sh"), "#!/bin/sh", { mode: 0o755 });

    const files = await listLocalFiles(dir);
    expect(files.map((f) => f.rel)).toEqual(["README.md", "run.sh", "src/lib/a.ts"]);
    expect(files.find((f) => f.rel === "run.sh")?.mode).toBe(0o755);
    expect(files.find((f) => f.rel === "README.md")?.size).toBe(2);
  });
});

describe("batchBySize", () => {
  test("splits files so each batch stays under the limit", () => {
    const files = [{ size: 4 }, { size: 4 }, { size: 4 }, { size: 20 }, { size: 1 }];
    expect(batchBySize(files, 10)).toEqual([
      [{ size: 4 }, { size: 4 }],
      [{ size: 4 }],
      [{ size: 20 }],
      [{ size: 1 }],
    ]);
  });

  test("returns no batches for no files", () => {
    expect(batchBySize([], 10)).toEqual([]);
  });
});

describe("parseFindOutput", () => {
  test("splits NUL-separated paths, including names with newlines", () => {
    expect(parseFindOutput("a.txt\0dir/b\nc.txt\0")).toEqual(["a.txt", "dir/b\nc.txt"]);
  });

  test("returns a single empty path when the source is a file", () => {
    expect(parseFindOutput("\0")).toEqual([""]);
  });

  test("returns nothing for an empty directory", () => {
    expect(parseFindOutput("")).toEqual([]);
  });
});

describe("parseFileMode", () => {
  test("parses octal modes", () => {
    expect(parseFileMode("755")).toBe(0o755);
    expect(parseFileMode("0644")).toBe(0o644);
  });

  test("rejects non-octal input", () => {
    expect(() => parseFileMode("rwx")).toThrow(/Invalid file mode/);
    expect(() => parseFileMode("999")).toThrow(/Invalid file mode/);
  });
});

describe("mapWithConcurrency", () => {
  test("processes every item without exceeding the limit", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      active--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(2);
  });
});
