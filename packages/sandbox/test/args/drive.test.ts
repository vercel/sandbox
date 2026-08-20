import { describe, expect, test } from "vitest";
import {
  parseDriveMount,
  driveMounts,
  driveRegion,
} from "../../src/args/drive";

describe("drive arguments", () => {
  test("parses and trims a drive region", async () => {
    await expect(driveRegion.from(" sfo1 ")).resolves.toBe("sfo1");
  });

  test("rejects an empty drive region", async () => {
    await expect(driveRegion.from("   ")).rejects.toThrow(
      "Drive region cannot be empty.",
    );
  });

  test("parses read-write drive mounts", () => {
    expect(parseDriveMount("cache:/data")).toEqual({
      drive: "cache",
      path: "/data",
      mode: undefined,
    });
  });

  test("parses read-only drive mounts", () => {
    expect(parseDriveMount("cache:/data:read-only")).toEqual({
      drive: "cache",
      path: "/data",
      mode: "read-only",
    });
  });

  test("leaves mount path validation to the API", () => {
    expect(parseDriveMount("cache:data")).toEqual({
      drive: "cache",
      path: "data",
      mode: undefined,
    });
  });

  test("passes overlapping mount paths through to the API", async () => {
    await expect(
      driveMounts.from(["cache:/data", "nested-cache:/data/cache"]),
    ).resolves.toEqual({
      "/data": { drive: "cache", mode: undefined },
      "/data/cache": { drive: "nested-cache", mode: undefined },
    });
  });
});
