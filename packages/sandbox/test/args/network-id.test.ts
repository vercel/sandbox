import { describe, expect, test } from "vitest";
import * as cmd from "cmd-ts";
import { networkId, networkIdOrNoneType } from "../../src/args/network-id.ts";

describe("network ID args", () => {
  const command = cmd.command({
    name: "test",
    args: { networkId },
    handler(args) {
      return args;
    },
  });

  test("parses and trims a network ID", async () => {
    const args = await cmd.run(command, ["--network-id", " network_123 "]);
    expect(args.networkId).toBe("network_123");
  });

  test("defaults to undefined when omitted", async () => {
    expect((await cmd.run(command, [])).networkId).toBeUndefined();
  });

  test("parses none as null for updates", async () => {
    expect(await networkIdOrNoneType.from(" none ")).toBeNull();
  });

  test("rejects invalid values", async () => {
    await expect(cmd.run(command, ["--network-id", " "])).rejects.toThrow();
    await expect(
      cmd.run(command, ["--network-id", "x".repeat(256)]),
    ).rejects.toThrow();
  });
});
