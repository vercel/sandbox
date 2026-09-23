import { describe, expect, test } from "vitest";
import {
  parseDriveMount,
  driveMounts,
  driveRegion,
} from "../../src/args/drive";

describe("drive arguments", () => {
  test("rejects read-only mount inputs", async () => {
    expect(() => parseDriveMount("cache:/data:read-only")).toThrow(
      "Invalid drive mount mode: read-only.",
    );
    await expect(driveMounts.from(["cache:/data:read-only"])).rejects.toThrow(
      "Invalid drive mount mode: read-only.",
    );
  });

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

  test("parses snapshot drive mounts", () => {
    expect(parseDriveMount("cache:/data:snapshot")).toEqual({
      drive: "cache",
      path: "/data",
      mode: "snapshot",
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
      "/data": { drive: "cache", mode: "read-write" },
      "/data/cache": { drive: "nested-cache", mode: "read-write" },
    });
  });
});
