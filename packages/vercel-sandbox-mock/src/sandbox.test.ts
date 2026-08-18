import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { Sandbox } from "./sandbox";

const uniq = () => `sb-${randomUUID().slice(0, 8)}`;

describe("Sandbox (real SDK over mock fetch)", () => {
  test("create returns a working, disposable sandbox", async () => {
    const sandbox = await Sandbox.create({ name: uniq() });
    const result = await sandbox.runCommand("echo", ["hi"]);
    expect(await result.stdout()).toBe("hi\n");
    await sandbox.stop();
  });

  test("create defaults the region and honors an explicit region", async () => {
    const withDefault = await Sandbox.create({ name: uniq() });
    expect(withDefault.region).toBe("iad1");
    await withDefault.delete();

    const withRegion = await Sandbox.create({
      name: uniq(),
      region: "sfo1",
      failoverRegions: ["iad1"],
    });
    expect(withRegion.region).toBe("sfo1");
    expect(withRegion.failoverRegions).toEqual(["iad1"]);
    await withRegion.delete();
  });

  test("create rejects failover regions that include the requested region", async () => {
    await expect(
      Sandbox.create({
        name: uniq(),
        region: "sfo1",
        failoverRegions: ["sfo1"],
      }),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  test("create accepts failover regions that only collide with the default region", async () => {
    // Nothing the caller can act on, so the overlap is filtered on read
    // instead of rejected.
    const sandbox = await Sandbox.create({
      name: uniq(),
      failoverRegions: ["iad1", "sfo1"],
    });
    expect(sandbox.region).toBe("iad1");
    expect(sandbox.failoverRegions).toEqual(["sfo1"]);
    await sandbox.delete();
  });

  test("update changes the region and the failover regions", async () => {
    const sandbox = await Sandbox.create({
      name: uniq(),
      region: "iad1",
      failoverRegions: ["sfo1"],
    });

    await sandbox.update({ region: "cle1" });
    expect(sandbox.region).toBe("cle1");
    expect(sandbox.failoverRegions).toEqual(["sfo1"]);

    await sandbox.update({ failoverRegions: ["iad1", "sfo1"] });
    expect(sandbox.failoverRegions).toEqual(["iad1", "sfo1"]);

    // Both sides at once, and the values survive a re-read.
    await sandbox.update({ region: "sfo1", failoverRegions: ["iad1"] });
    const reread = await Sandbox.get({ name: sandbox.name });
    expect(reread.region).toBe("sfo1");
    expect(reread.failoverRegions).toEqual(["iad1"]);

    await sandbox.update({ failoverRegions: [] });
    expect(sandbox.failoverRegions).toEqual([]);

    await sandbox.delete();
  });

  test("update rejects failover regions that include the sandbox region", async () => {
    const sandbox = await Sandbox.create({ name: uniq(), region: "sfo1" });

    await expect(
      sandbox.update({ failoverRegions: ["sfo1"] }),
    ).rejects.toMatchObject({ response: { status: 400 } });

    // The same collision reached by moving the region instead.
    await sandbox.update({ failoverRegions: ["cle1"] });
    await expect(sandbox.update({ region: "cle1" })).rejects.toMatchObject({
      response: { status: 400 },
    });
    expect(sandbox.region).toBe("sfo1");

    await sandbox.delete();
  });

  test("get on an unknown name throws a 404 APIError", async () => {
    await expect(Sandbox.get({ name: "does-not-exist" })).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  test("getOrCreate runs onCreate exactly once for a name", async () => {
    const name = uniq();
    let created = 0;
    const first = await Sandbox.getOrCreate({ name, onCreate: async () => void created++ });
    const second = await Sandbox.getOrCreate({ name, onCreate: async () => void created++ });
    expect(created).toBe(1);
    expect(second.name).toBe(name);
    await first.delete();
  });

  test("list filters by namePrefix and is async-iterable", async () => {
    const prefix = `list-${randomUUID().slice(0, 6)}-`;
    await Sandbox.create({ name: `${prefix}a` });
    await Sandbox.create({ name: `${prefix}b` });

    const page = await Sandbox.list({ namePrefix: prefix });
    const names = page.sandboxes.map((s) => s.name).sort();
    expect(names).toEqual([`${prefix}a`, `${prefix}b`]);

    const collected: string[] = [];
    for await (const sandbox of await Sandbox.list({ namePrefix: prefix })) {
      collected.push(sandbox.name);
    }
    expect(collected.sort()).toEqual([`${prefix}a`, `${prefix}b`]);
  });

  test("a command after stop auto-resumes the sandbox and preserves the disk", async () => {
    const sandbox = await Sandbox.create({ name: uniq() });
    await sandbox.writeFiles([{ path: "/tmp/keep.txt", content: "kept" }]);
    const firstSession = sandbox.currentSession().sessionId;
    await sandbox.currentSession().stop();

    // withResume catches the 410 and transparently starts a new session.
    const result = await sandbox.runCommand("cat", ["/tmp/keep.txt"]);
    expect(await result.stdout()).toBe("kept");
    expect(sandbox.currentSession().sessionId).not.toBe(firstSession);
    await sandbox.stop();
  });

  test("update({ ports }) refreshes routes so domain() resolves", async () => {
    const sandbox = await Sandbox.create({ name: uniq() });
    await sandbox.update({ ports: [8080] });
    expect(sandbox.domain(8080)).toBe(sandbox.routes.find((r) => r.port === 8080)?.url);
    expect(() => sandbox.domain(9999)).toThrow(/No route/);
    await sandbox.stop();
  });

  test("detached commands expose wait/logs/kill", async () => {
    const sandbox = await Sandbox.create({ name: uniq() });
    const command = await sandbox.runCommand({ cmd: "echo", args: ["detached"], detached: true });
    expect(typeof command.cmdId).toBe("string");

    const finished = await command.wait();
    expect(finished.exitCode).toBe(0);

    const lines: string[] = [];
    for await (const log of command.logs()) lines.push(log.data);
    expect(lines.join("")).toContain("detached");

    await expect(command.kill()).resolves.not.toThrow();
    await sandbox.stop();
  });
});
