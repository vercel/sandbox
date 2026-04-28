import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatNextCursorHint } from "./output";

describe("formatNextCursorHint", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  function setArgs(args: string[]) {
    process.argv = ["/usr/local/bin/node", "/path/to/sandbox.mjs", ...args];
  }

  it("appends --cursor when no cursor was passed", () => {
    setArgs(["list", "--limit", "2"]);
    expect(formatNextCursorHint("cur1")).toBe(
      "\nMore results: sandbox list --limit 2 --cursor cur1",
    );
  });

  it("preserves boolean flags", () => {
    setArgs(["list", "--all"]);
    expect(formatNextCursorHint("cur1")).toBe(
      "\nMore results: sandbox list --all --cursor cur1",
    );
  });

  it("preserves positional arguments", () => {
    setArgs(["sessions", "list", "my-sandbox", "--limit", "5"]);
    expect(formatNextCursorHint("abc")).toBe(
      "\nMore results: sandbox sessions list my-sandbox --limit 5 --cursor abc",
    );
  });

  it("strips an existing --cursor X form", () => {
    setArgs(["list", "--limit", "2", "--cursor", "old"]);
    expect(formatNextCursorHint("new")).toBe(
      "\nMore results: sandbox list --limit 2 --cursor new",
    );
  });

  it("strips an existing --cursor=X form", () => {
    setArgs(["list", "--limit", "2", "--cursor=old"]);
    expect(formatNextCursorHint("new")).toBe(
      "\nMore results: sandbox list --limit 2 --cursor new",
    );
  });

  it("works with no arguments", () => {
    setArgs(["list"]);
    expect(formatNextCursorHint("cur")).toBe(
      "\nMore results: sandbox list --cursor cur",
    );
  });
});
