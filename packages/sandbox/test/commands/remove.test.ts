import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockGet, mockDelete, mockSnapshotList } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockDelete: vi.fn(),
  mockSnapshotList: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: { get: mockGet },
  snapshotClient: { list: mockSnapshotList },
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

const args = ["my-sandbox", "--scope=team", "--project=proj"];

function snapshot(id: string, sizeBytes: number, status = "created") {
  return { id, sizeBytes, status };
}

describe("remove command", () => {
  let stderr: string;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_AUTH_TOKEN = "tok";
    process.exitCode = undefined;
    mockGet.mockResolvedValue({ delete: mockDelete });
    stderr = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("reports the snapshots the removal kept and how to delete them", async () => {
    mockSnapshotList.mockResolvedValue({
      snapshots: [snapshot("snap_one", 784 * 1024 * 1024)],
      pagination: { next: null },
    });

    const { remove } = await import("../../src/commands/remove.ts");
    await cmd.run(remove, args);

    expect(mockDelete).toHaveBeenCalledWith({ deleteOrphanSnapshots: false });
    expect(stderr).toContain("kept snapshot snap_one");
    expect(stderr).toContain("784 MiB");
    expect(stderr).toContain("sandbox snapshots delete snap_one");
  });

  test("totals multiple snapshots and skips ones already deleted", async () => {
    mockSnapshotList.mockResolvedValue({
      snapshots: [
        snapshot("snap_one", 1024 * 1024),
        snapshot("snap_two", 1024 * 1024),
        snapshot("snap_gone", 999 * 1024 * 1024, "deleted"),
      ],
      pagination: { next: null },
    });

    const { remove } = await import("../../src/commands/remove.ts");
    await cmd.run(remove, args);

    expect(stderr).toContain("kept 2 snapshots");
    expect(stderr).toContain("2 MiB");
    expect(stderr).not.toContain("snap_gone");
  });

  test("says nothing when the sandbox has no snapshots", async () => {
    mockSnapshotList.mockResolvedValue({
      snapshots: [],
      pagination: { next: null },
    });

    const { remove } = await import("../../src/commands/remove.ts");
    await cmd.run(remove, args);

    expect(stderr).not.toContain("kept");
  });

  test("does not list snapshots when --delete-orphan-snapshots is passed", async () => {
    const { remove } = await import("../../src/commands/remove.ts");
    await cmd.run(remove, [...args, "--delete-orphan-snapshots"]);

    expect(mockSnapshotList).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
    expect(stderr).not.toContain("kept");
  });

  test("removes the sandbox even when the snapshot listing fails", async () => {
    mockSnapshotList.mockRejectedValue(new Error("listing unavailable"));

    const { remove } = await import("../../src/commands/remove.ts");
    await cmd.run(remove, args);

    expect(mockDelete).toHaveBeenCalledWith({ deleteOrphanSnapshots: false });
    expect(process.exitCode).not.toBe(1);
    expect(stderr).not.toContain("kept");
  });
});
