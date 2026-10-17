import { describe, expect, test } from "vitest";
import { parseLocalOrRemotePath, parseRemotePath } from "../../src/commands/cp";

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
      sandboxName: "my-sandbox",
      path: "/home/user/file.txt",
    });
  });
});

describe("remote path parsing", () => {
  test("accepts SANDBOX_NAME:PATH", async () => {
    await expect(parseRemotePath("my-sandbox:/app/index.js")).resolves.toEqual({
      type: "remote",
      sandboxName: "my-sandbox",
      path: "/app/index.js",
    });
  });

  test("rejects local paths with a hint", async () => {
    await expect(parseRemotePath("./index.js")).rejects.toThrow(
      /SANDBOX_NAME:PATH/,
    );
  });
});
