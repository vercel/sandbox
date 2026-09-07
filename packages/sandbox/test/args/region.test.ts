import { describe, test, expect } from "vitest";
import * as cmd from "cmd-ts";
import { region, failoverRegions } from "../../src/args/region.ts";

describe("region args", () => {
  const command = cmd.command({
    name: "test",
    args: { region, failoverRegions },
    handler(args) {
      return args;
    },
  });

  test("parses a comma-separated failover region list", async () => {
    const args = await cmd.run(command, [
      "--region",
      " cle1 ",
      "--failover-regions",
      "sfo1, iad1 ,sfo1",
    ]);

    expect(args.region).toBe("cle1");
    expect(args.failoverRegions).toEqual(["sfo1", "iad1"]);
  });

  test("defaults to undefined when the flags are omitted", async () => {
    const args = await cmd.run(command, []);

    expect(args.region).toBeUndefined();
    expect(args.failoverRegions).toBeUndefined();
  });

  test('parses "none" as an empty failover region list', async () => {
    const args = await cmd.run(command, ["--failover-regions", " none "]);

    expect(args.failoverRegions).toEqual([]);
  });

  test('rejects "none" combined with region names', async () => {
    await expect(
      cmd.run(command, ["--failover-regions", "sfo1,none"]),
    ).rejects.toThrow();
  });

  test("rejects empty values", async () => {
    await expect(cmd.run(command, ["--region", " "])).rejects.toThrow();
    await expect(
      cmd.run(command, ["--failover-regions", " , "]),
    ).rejects.toThrow();
  });
});
