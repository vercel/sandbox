import { describe, expect, test } from "vitest";
import { parseLocalOrRemotePath } from "../../src/commands/cp";

describe("copy path parsing", () => {
  test("accepts non-existent local paths", async () => {
    await expect(parseLocalOrRemotePath("./does-not-exist.txt")).resolves.toEqual(
      {
        type: "local",
        path: "./does-not-exist.txt",
      },
    );
  });

  test("parses remote paths with a sandbox name", async () => {
    await expect(
      parseLocalOrRemotePath("my-sandbox:/home/user/file.txt"),
    ).resolves.toEqual({
      type: "remote",
      sandboxId: "my-sandbox",
      path: "/home/user/file.txt",
    });
  });
});
