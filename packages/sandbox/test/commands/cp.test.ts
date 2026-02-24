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

  test("parses remote paths", async () => {
    await expect(
      parseLocalOrRemotePath("sbx_Z1bhKlvVP1ecxCg2ewRUSU0hg1ik:/etc/os-release"),
    ).resolves.toEqual({
      type: "remote",
      id: "sbx_Z1bhKlvVP1ecxCg2ewRUSU0hg1ik",
      path: "/etc/os-release",
    });
  });
});
