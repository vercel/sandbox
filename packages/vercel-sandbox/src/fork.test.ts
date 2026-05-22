import { describe, expect, it } from "vitest";
import ms from "ms";
import { Sandbox } from "./sandbox.js";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "Sandbox.fork",
  () => {
    it("forks a sandbox, copying its config and filesystem", async () => {
      const baseSandbox = await Sandbox.create({
        persistent: true,
        resources: { vcpus: 2 },
        timeout: ms("10m"),
        tags: { kind: "fork-source" },
      });
      await baseSandbox.writeFiles([
        { path: "from-base.txt", content: Buffer.from("base content") },
      ]);
      await baseSandbox.stop();

      const fork = await Sandbox.fork({ source: baseSandbox.name });

      try {
        expect(fork.sourceSnapshotId).toBe(baseSandbox.currentSnapshotId);
        expect(fork.vcpus).toBe(2);
        expect(fork.timeout).toBe(ms("10m"));
        expect(fork.tags).toEqual({ kind: "fork-source" });

        const content = await fork.readFileToBuffer({ path: "from-base.txt" });
        expect(content?.toString()).toBe("base content");
      } finally {
        await fork.delete();
        await baseSandbox.delete();
      }
    });

    it("applies overrides on top of the copied source config", async () => {
      const baseSandbox = await Sandbox.create({
        persistent: true,
        resources: { vcpus: 1 },
        tags: { kind: "fork-source" },
      });
      await baseSandbox.stop();

      const fork = await Sandbox.fork({
        source: baseSandbox.name,
        name: `${baseSandbox.name}-fork`,
        resources: { vcpus: 2 },
        tags: { kind: "fork-override" },
      });

      try {
        expect(fork.name).toBe(`${baseSandbox.name}-fork`);
        expect(fork.vcpus).toBe(2);
        expect(fork.tags).toEqual({ kind: "fork-override" });
      } finally {
        await fork.delete();
        await baseSandbox.delete();
      }
    });

    it("throws when the source sandbox has no current snapshot", async () => {
      const baseSandbox = await Sandbox.create();
      try {
        expect(baseSandbox.currentSnapshotId).toBeUndefined();

        await expect(
          Sandbox.fork({ source: baseSandbox.name }),
        ).rejects.toThrow(/has no current snapshot/);
      } finally {
        await baseSandbox.delete();
      }
    });

    it("propagates a not-found error when the source sandbox does not exist", async () => {
      await expect(
        Sandbox.fork({ source: "this-sandbox-does-not-exist-xyz" }),
      ).rejects.toThrow();
    });
  },
);
