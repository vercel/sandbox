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
const MiB = 1024 * 1024;
const inThirtyDays = Date.now() + 30 * 24 * 60 * 60 * 1000;

function snapshot(
  id: string,
  sizeBytes: number,
  overrides: { status?: string; expiresAt?: number | null } = {},
) {
  return {
    id,
    sizeBytes,
    status: overrides.status ?? "created",
    expiresAt: "expiresAt" in overrides ? overrides.expiresAt : inThirtyDays,
  };
}

function page(snapshots: unknown[], next: string | null = null) {
  return { snapshots, pagination: { next } };
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

  async function run(extraArgs: string[] = []) {
    const { remove } = await import("../../src/commands/remove.ts");
    await cmd.run(remove, [...args, ...extraArgs]);
  }

  test("reports a single kept snapshot with its expiry and delete command", async () => {
    mockSnapshotList.mockResolvedValue(page([snapshot("snap_one", 784 * MiB)]));

    await run();

    expect(mockDelete).toHaveBeenCalledWith({ deleteOrphanSnapshots: false });
    expect(stderr).toContain("kept snapshot snap_one");
    expect(stderr).toContain("784 MiB");
    expect(stderr).toContain("expires in");
    expect(stderr).toContain("sandbox snapshots delete snap_one");
  });

  test("says no expiry instead of claiming the snapshot expires", async () => {
    mockSnapshotList.mockResolvedValue(
      page([snapshot("snap_one", MiB, { expiresAt: null })]),
    );

    await run();

    expect(stderr).toContain("no expiry");
    expect(stderr).not.toContain("expires in");
  });

  test("counts only created snapshots, not failed or deleted ones", async () => {
    mockSnapshotList.mockResolvedValue(
      page([
        snapshot("snap_one", MiB),
        snapshot("snap_two", MiB),
        snapshot("snap_failed", 999 * MiB, { status: "failed" }),
        snapshot("snap_gone", 999 * MiB, { status: "deleted" }),
      ]),
    );

    await run();

    expect(stderr).toContain("kept 2 snapshots");
    expect(stderr).toContain("2 MiB");
    expect(stderr).not.toContain("snap_failed");
    expect(stderr).not.toContain("snap_gone");
  });

  test("marks the size as partial and truncates ids when the listing paginates", async () => {
    mockSnapshotList.mockResolvedValue(
      page(
        Array.from({ length: 6 }, (_, i) => snapshot(`snap_${i}`, MiB)),
        "cursor_next",
      ),
    );

    await run();

    expect(stderr).toContain("kept 6+ snapshots");
    expect(stderr).toContain("so far");
    expect(stderr).toContain("...");
    expect(stderr).not.toContain("snap_5");
  });

  test("hedges the hint for multiple snapshots, which may be shared", async () => {
    mockSnapshotList.mockResolvedValue(
      page([snapshot("snap_one", MiB), snapshot("snap_two", MiB)]),
    );

    await run();

    expect(stderr).toContain("Delete the ones no other sandbox uses");
  });

  test("says the snapshots could not be checked when the listing fails", async () => {
    mockSnapshotList.mockRejectedValue(new Error("listing unavailable"));

    await run();

    expect(mockDelete).toHaveBeenCalledWith({ deleteOrphanSnapshots: false });
    expect(process.exitCode).not.toBe(1);
    expect(stderr).toContain("could not list snapshots");
    expect(stderr).toContain("sandbox snapshots ls");
  });

  test("says nothing when the sandbox has no snapshots", async () => {
    mockSnapshotList.mockResolvedValue(page([]));

    await run();

    expect(stderr).not.toContain("kept");
  });

  test("does not list snapshots when --delete-orphan-snapshots is passed", async () => {
    await run(["--delete-orphan-snapshots"]);

    expect(mockSnapshotList).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
    expect(stderr).not.toContain("kept");
  });

  test("still reports a sandbox that was removed when another removal fails", async () => {
    mockGet.mockImplementation(async ({ name }: { name: string }) => {
      if (name === "broken") throw new Error("sandbox not found");
      return { delete: mockDelete };
    });
    mockSnapshotList.mockResolvedValue(page([snapshot("snap_one", MiB)]));

    const { remove } = await import("../../src/commands/remove.ts");
    await cmd.run(remove, [
      "my-sandbox",
      "broken",
      "--scope=team",
      "--project=proj",
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderr).toContain("kept snapshot snap_one");
  });
});
