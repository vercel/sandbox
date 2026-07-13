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
