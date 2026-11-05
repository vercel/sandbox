import { expect, test } from "vitest";
import { calculateMissingBounds } from "../../src/util/managed-credentials-bounds";
import { parseConfig } from "../../src/util/managed-credentials-config";
const config = parseConfig({
  source: { type: "git", url: "https://github.com/o/r.git" },
  credentials: {
    github: [
      { repositories: ["o/r"], actions: ["git:write", "github:issues:read"] },
    ],
  },
});
test("Git workflow-write ceiling covers ordinary writes, while reporting only genuinely missing actions", () => {
  expect(
    calculateMissingBounds(config, {
      status: "known",
      bounds: [{ repo: "O/R", actions: ["git:write-workflows"] }],
    }),
  ).toEqual([{ repo: "o/r", actions: ["github:issues:read"] }]);
});
test("no project Bounds means no ceiling, not deny everything", () => {
  expect(
    calculateMissingBounds(config, { status: "known", bounds: [] }),
  ).toEqual([]);
});
test("configured Bounds with no actions still restrict access", () => {
  expect(
    calculateMissingBounds(config, {
      status: "known",
      bounds: [{ repo: "o/r", actions: [] }],
    }),
  ).toEqual([{ repo: "o/r", actions: ["git:write", "github:issues:read"] }]);
});
test("a failed policy lookup is never treated as an empty policy", () => {
  expect(() =>
    calculateMissingBounds(config, { status: "unknown", reason: "offline" }),
  ).toThrow("unreadable policy");
});
