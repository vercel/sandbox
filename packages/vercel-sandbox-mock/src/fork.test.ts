import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { Sandbox } from "./sandbox";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const uniq = () => `fork-${randomUUID().slice(0, 8)}`;

async function readEnv(sandbox: Sandbox, name: string): Promise<string> {
  const result = await sandbox.runCommand("printenv", [name]);
  return (await result.stdout()).trim();
}

describe("Sandbox.fork", () => {
  test("copies the source config when no overrides are given", async () => {
    const name = uniq();
    const source = await Sandbox.create({
      name,
      resources: { vcpus: 4 },
      timeout: 10 * MINUTE,
      tags: { kind: "source" },
      env: { FORKED: "yes" },
      ports: [3000, 8080],
      persistent: true,
      networkPolicy: "allow-all",
      snapshotExpiration: 7 * DAY,
      keepLastSnapshots: { count: 3 },
    });

    let fork: Sandbox | undefined;
    try {
      fork = await Sandbox.fork({ sourceSandbox: name });

      expect(fork.name).not.toBe(name);
      expect(fork.vcpus).toBe(4);
      expect(fork.timeout).toBe(10 * MINUTE);
      expect(fork.tags).toEqual({ kind: "source" });
      expect(fork.persistent).toBe(true);
      expect(fork.networkPolicy).toBe("allow-all");
      expect(fork.snapshotExpiration).toBe(7 * DAY);
      expect(fork.keepLastSnapshots?.count).toBe(3);

      const forkPorts = fork.routes.map((route) => route.port).sort((a, b) => a - b);
      expect(forkPorts).toEqual([3000, 8080]);

      expect(await readEnv(fork, "FORKED")).toBe("yes");
    } finally {
      await Promise.allSettled([fork?.delete(), source.delete()]);
    }
  });

  test("applies overrides on top of the copied source config", async () => {
    const name = uniq();
    const source = await Sandbox.create({
      name,
      resources: { vcpus: 1 },
      timeout: 5 * MINUTE,
      tags: { kind: "source" },
      env: { FORKED: "source" },
      persistent: true,
      networkPolicy: "allow-all",
      snapshotExpiration: 7 * DAY,
      keepLastSnapshots: { count: 3 },
    });

    const forkName = `${name}-child`;
    let fork: Sandbox | undefined;
    try {
      fork = await Sandbox.fork({
        sourceSandbox: name,
        name: forkName,
        resources: { vcpus: 2 },
        timeout: 10 * MINUTE,
        tags: { kind: "override" },
        env: { FORKED: "override" },
        persistent: false,
        networkPolicy: "deny-all",
        snapshotExpiration: 14 * DAY,
        keepLastSnapshots: { count: 5 },
      });

      expect(fork.name).toBe(forkName);
      expect(fork.vcpus).toBe(2);
      expect(fork.timeout).toBe(10 * MINUTE);
      expect(fork.tags).toEqual({ kind: "override" });
      expect(fork.persistent).toBe(false);
      expect(fork.networkPolicy).toBe("deny-all");
      expect(fork.snapshotExpiration).toBe(14 * DAY);
      expect(fork.keepLastSnapshots?.count).toBe(5);

      expect(await readEnv(fork, "FORKED")).toBe("override");
    } finally {
      await Promise.allSettled([fork?.delete(), source.delete()]);
    }
  });

  test("rejects when the source sandbox does not exist", async () => {
    await expect(
      Sandbox.fork({ sourceSandbox: `missing-${randomUUID().slice(0, 8)}` }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });
});
