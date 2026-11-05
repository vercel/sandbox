import { describe, expect, test } from "vitest";
import { parseCommitAs } from "../../src/util/managed-credentials-commit";
import {
  runCommand,
  readCommand,
} from "../../src/util/managed-credentials-command";

describe("read-only metadata helpers", () => {
  test("distinguishes missing helpers from failed commands", async () => {
    expect(await runCommand("sandbox-nonexistent-command", [], 1000)).toEqual({
      status: "absent",
    });
    expect(
      (await runCommand(process.execPath, ["-e", "process.exit(1)"], 1000))
        .status,
    ).toBe("failed");
    expect(
      await readCommand(process.execPath, ["-e", "process.exit(1)"], 1000),
    ).toBeUndefined();
  });
  test("bounds execution time", async () => {
    expect(
      (
        await runCommand(
          process.execPath,
          ["-e", "setInterval(()=>{},1000)"],
          50,
        )
      ).status,
    ).toBe("failed");
  });
});
describe("commit identity", () => {
  test("parses explicit credit", () => {
    expect(parseCommitAs(" Ada Lovelace <ada@example.com> ")).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });
  test.each(["Ada", "<ada@example.com>", "Ada <invalid>"])(
    "rejects %s",
    (value) => {
      expect(() => parseCommitAs(value)).toThrow();
    },
  );
});
