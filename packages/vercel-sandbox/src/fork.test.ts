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

      const fork = await Sandbox.fork({ sourceSandbox: baseSandbox.name });

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
        timeout: ms("5m"),
        tags: { kind: "fork-source" },
        snapshotExpiration: ms("7d"),
        keepLastSnapshots: { count: 3 },
        networkPolicy: "allow-all",
      });
      await baseSandbox.stop();

      const fork = await Sandbox.fork({
        sourceSandbox: baseSandbox.name,
        name: `${baseSandbox.name}-fork`,
        resources: { vcpus: 2 },
        timeout: ms("10m"),
        tags: { kind: "fork-override", extra: "set" },
        env: { FOO: "1" },
        snapshotExpiration: ms("14d"),
        keepLastSnapshots: { count: 5 },
        networkPolicy: "deny-all",
        persistent: false,
      });

      try {
        expect(fork.name).toBe(`${baseSandbox.name}-fork`);
        expect(fork.vcpus).toBe(2);
        expect(fork.timeout).toBe(ms("10m"));
        expect(fork.tags).toEqual({ kind: "fork-override", extra: "set" });
        expect(fork.snapshotExpiration).toBe(ms("14d"));
        expect(fork.keepLastSnapshots?.count).toBe(5);
        expect(fork.networkPolicy).toBe("deny-all");
        expect(fork.persistent).toBe(false);
      } finally {
        await fork.delete();
        await baseSandbox.delete();
      }
    });
  },
);
