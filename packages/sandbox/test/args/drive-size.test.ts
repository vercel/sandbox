import { describe, test, expect } from "vitest";
import { parseDriveSize } from "../../src/args/drive.ts";

describe("parseDriveSize", () => {
  test("accepts binary units, case-insensitive, with or without the i", () => {
    expect(parseDriveSize("5GiB")).toBe(5 * 1024 ** 3);
    expect(parseDriveSize("5gib")).toBe(5 * 1024 ** 3);
    expect(parseDriveSize("5GB")).toBe(5 * 1024 ** 3);
    expect(parseDriveSize("5G")).toBe(5 * 1024 ** 3);
    expect(parseDriveSize("2TiB")).toBe(2 * 1024 ** 4);
    expect(parseDriveSize("2tib")).toBe(2 * 1024 ** 4);
    expect(parseDriveSize("16 TiB")).toBe(16 * 1024 ** 4);
    expect(parseDriveSize("512MiB")).toBe(512 * 1024 ** 2);
    expect(parseDriveSize("1KiB")).toBe(1024);
  });

  test("treats a bare number as bytes", () => {
    expect(parseDriveSize("500")).toBe(500);
    expect(parseDriveSize("5368709120")).toBe(5368709120);
    expect(parseDriveSize(" 1024 ")).toBe(1024);
    expect(parseDriveSize("1024B")).toBe(1024);
  });

  test("accepts decimals and rounds to whole bytes", () => {
    expect(parseDriveSize("1.5GiB")).toBe(1610612736);
    expect(parseDriveSize("0.5TiB")).toBe(512 * 1024 ** 3);
  });

  test("rejects anything it cannot parse instead of truncating", () => {
    for (const bad of ["abc", "5 apples", "-1", "0", "", "2TiBs", "GiB", "1e3"]) {
      expect(() => parseDriveSize(bad), bad).toThrowError(/Invalid size/);
    }
  });
});
