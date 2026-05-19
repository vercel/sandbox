import { describe, expect, test } from "vitest";
import { parseVolumeMount, volumeMounts } from "../../src/args/volume";

describe("volume arguments", () => {
  test("parses read-write volume mounts", () => {
    expect(parseVolumeMount("cache:/data")).toEqual({
      volume: "cache",
      path: "/data",
      mode: undefined,
    });
  });

  test("parses read-only volume mounts", () => {
    expect(parseVolumeMount("cache:/data:read-only")).toEqual({
      volume: "cache",
      path: "/data",
      mode: "read-only",
    });
  });

  test("leaves mount path validation to the API", () => {
    expect(parseVolumeMount("cache:data")).toEqual({
      volume: "cache",
      path: "data",
      mode: undefined,
    });
  });

  test("passes overlapping mount paths through to the API", async () => {
    await expect(volumeMounts.from(["cache:/data", "nested-cache:/data/cache"]))
      .resolves.toEqual({
        "/data": { volume: "cache", mode: undefined },
        "/data/cache": { volume: "nested-cache", mode: undefined },
      });
  });
});
