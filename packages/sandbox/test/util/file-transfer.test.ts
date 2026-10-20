import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  batchBySize,
  listLocalEntries,
  mapWithConcurrency,
  parseFileMode,
  parseFindEntries,
} from "../../src/util/file-transfer";

describe("listLocalEntries", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-cp-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("lists files, directories, and symlinks without following links", async () => {
    await fs.mkdir(path.join(dir, "src", "lib"), { recursive: true });
    await fs.mkdir(path.join(dir, "empty"));
    await fs.writeFile(path.join(dir, "README.md"), "hi");
    await fs.writeFile(path.join(dir, "src", "lib", "a.ts"), "export {}");
    await fs.writeFile(path.join(dir, "run.sh"), "#!/bin/sh", { mode: 0o755 });
    await fs.symlink("../README.md", path.join(dir, "src", "readme-link"));

    const entries = await listLocalEntries(dir);
    expect(entries.map((entry) => [entry.rel, entry.type])).toEqual([
      ["empty", "directory"],
      ["README.md", "file"],
      ["run.sh", "file"],
      ["src", "directory"],
      ["src/lib", "directory"],
      ["src/lib/a.ts", "file"],
      ["src/readme-link", "symlink"],
    ]);
    expect(entries.find((entry) => entry.rel === "run.sh")?.mode).toBe(0o755);
    expect(entries.find((entry) => entry.rel === "README.md")?.size).toBe(2);
    expect(
      entries.find((entry) => entry.rel === "src/readme-link"),
    ).toMatchObject({
      type: "symlink",
      target: "../README.md",
    });
  });
});

describe("batchBySize", () => {
  test("splits files so each batch stays under the limit", () => {
    const files = [
      { size: 4 },
      { size: 4 },
      { size: 4 },
      { size: 20 },
      { size: 1 },
    ];
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

describe("parseFindEntries", () => {
  test("parses NUL-separated tree metadata, including names with newlines", () => {
    expect(
      parseFindEntries(
        [
          "d",
          "",
          "755",
          "",
          "f",
          "a.txt",
          "644",
          "",
          "l",
          "dir/b\nc.txt",
          "777",
          "../a.txt",
          "",
        ].join("\0"),
      ),
    ).toEqual([
      { type: "directory", rel: "", mode: 0o755 },
      { type: "file", rel: "a.txt", mode: 0o644 },
      {
        type: "symlink",
        rel: "dir/b\nc.txt",
        mode: 0o777,
        target: "../a.txt",
      },
    ]);
  });

  test("rejects incomplete metadata", () => {
    expect(() =>
      parseFindEntries(["f", "a.txt", "644", ""].join("\0")),
    ).toThrow(/Invalid file listing/);
  });

  test("returns nothing for empty output", () => {
    expect(parseFindEntries("")).toEqual([]);
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
  test("returns ordered results without exceeding the limit", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      2,
      async (n) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        seen.push(n);
        active--;
        return n * 2;
      },
    );
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(2);
  });
});
