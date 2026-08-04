import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { Sandbox } from "./sandbox";
import { Snapshot } from "./snapshot";
import { expectForkToPreserveSnapshotFileSystem } from "./test-scenarios";

describe("Snapshot (real SDK over mock fetch)", () => {
  test("snapshot is visible via instance and static lookups, then deletable", async () => {
    const name = `snap-${randomUUID().slice(0, 8)}`;
    const sandbox = await Sandbox.create({ name });
    await sandbox.fs.writeFile("/tmp/state.txt", "captured");
    const snapshot = await sandbox.snapshot();

    expect((await sandbox.listSnapshots()).snapshots.map((s) => s.id)).toContain(
      snapshot.snapshotId,
    );
    expect((await Snapshot.list({ name })).snapshots.map((s) => s.id)).toContain(
      snapshot.snapshotId,
    );

    const got = await Snapshot.get({ snapshotId: snapshot.snapshotId });
    expect(got.sourceSessionId).toBe(snapshot.sourceSessionId);

    await got.delete();
    expect((await sandbox.listSnapshots()).snapshots).toContainEqual(
      expect.objectContaining({ id: snapshot.snapshotId, status: "deleted" }),
    );
    await sandbox.delete();
  });

  test("a sandbox created from a snapshot restores its filesystem", async () => {
    const sandbox = await Sandbox.create({ name: `snap-src-${randomUUID().slice(0, 8)}` });
    await sandbox.fs.writeFile("/tmp/seed.txt", "from-snapshot");
    const snapshot = await sandbox.snapshot();

    const restored = await Sandbox.create({
      name: `snap-dst-${randomUUID().slice(0, 8)}`,
      source: { type: "snapshot", snapshotId: snapshot.snapshotId },
    });
    expect(await restored.fs.readFile("/tmp/seed.txt", "utf8")).toBe("from-snapshot");
    await sandbox.delete();
    await restored.delete();
  });

  test("fork preserves snapshot bytes, modes, symlinks, and isolation", async () => {
    await expectForkToPreserveSnapshotFileSystem(Sandbox);
  });
});
