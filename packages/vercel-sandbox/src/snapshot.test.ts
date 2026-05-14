import { describe, expect, it } from "vitest";
import { Sandbox } from "./sandbox.js";
import { Snapshot } from "./snapshot.js";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "Snapshot.fromSandbox",
  () => {
    it("resolves a snapshot ID that can seed a new sandbox", async () => {
      const baseSandbox = await Sandbox.create({ persistent: true });
      await baseSandbox.writeFiles([
        { path: "from-base.txt", content: Buffer.from("base content") },
      ]);
      await baseSandbox.stop();

      const derived = await Sandbox.create({
        source: {
          type: "snapshot",
          snapshotId: await Snapshot.fromSandbox(baseSandbox.name),
        },
      });

      try {
        expect(derived.sourceSnapshotId).toBe(baseSandbox.currentSnapshotId);
        const content = await derived.readFileToBuffer({
          path: "from-base.txt",
        });
        expect(content?.toString()).toBe("base content");
      } finally {
        await derived.stop();
      }
    });

    it("throws when the sandbox has no current snapshot", async () => {
      const baseSandbox = await Sandbox.create();
      expect(baseSandbox.currentSnapshotId).toBeUndefined();

      await expect(Snapshot.fromSandbox(baseSandbox.name)).rejects.toThrow(
        /has no current snapshot/,
      );
    });
  },
);
