import { describe, it, expect } from "vitest";
import { buildKeepLastSnapshotsPayload } from "./keep-last-snapshots";

describe("buildKeepLastSnapshotsPayload", () => {
  it("returns undefined when no retention flag is passed", () => {
    expect(
      buildKeepLastSnapshotsPayload({
        keepLastSnapshots: undefined,
        keepLastSnapshotsFor: undefined,
        deleteEvictedSnapshots: undefined,
      }),
    ).toBeUndefined();
  });

  it("builds the payload from a count", () => {
    expect(
      buildKeepLastSnapshotsPayload({
        keepLastSnapshots: 3,
        keepLastSnapshotsFor: undefined,
        deleteEvictedSnapshots: undefined,
      }),
    ).toEqual({ count: 3, expiration: undefined, deleteEvicted: undefined });
  });

  it("builds the payload from all the flags", () => {
    expect(
      buildKeepLastSnapshotsPayload({
        keepLastSnapshots: 2,
        keepLastSnapshotsFor: "7d",
        deleteEvictedSnapshots: "true",
      }),
    ).toEqual({
      count: 2,
      expiration: 7 * 24 * 60 * 60 * 1000,
      deleteEvicted: true,
    });
  });

  it("returns null for a count of 0 to disable the default policy", () => {
    expect(
      buildKeepLastSnapshotsPayload({
        keepLastSnapshots: 0,
        keepLastSnapshotsFor: undefined,
        deleteEvictedSnapshots: undefined,
      }),
    ).toBeNull();
  });

  it("throws when a count of 0 is combined with an expiration", () => {
    expect(() =>
      buildKeepLastSnapshotsPayload({
        keepLastSnapshots: 0,
        keepLastSnapshotsFor: "7d",
        deleteEvictedSnapshots: undefined,
      }),
    ).toThrow(/cannot be combined with --keep-last-snapshots 0/);
  });

  it("throws when a count of 0 is combined with --delete-evicted-snapshots", () => {
    expect(() =>
      buildKeepLastSnapshotsPayload({
        keepLastSnapshots: 0,
        keepLastSnapshotsFor: undefined,
        deleteEvictedSnapshots: "false",
      }),
    ).toThrow(/cannot be combined with --keep-last-snapshots 0/);
  });

  it("throws when the companion flags are passed without a count", () => {
    expect(() =>
      buildKeepLastSnapshotsPayload({
        keepLastSnapshots: undefined,
        keepLastSnapshotsFor: "7d",
        deleteEvictedSnapshots: undefined,
      }),
    ).toThrow(/require --keep-last-snapshots/);
  });
});
