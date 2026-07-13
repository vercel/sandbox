import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Sandbox } from "./sandbox";

describe("Command (real SDK over mock fetch)", () => {
  let sandbox: Sandbox;
  beforeAll(async () => {
    sandbox = await Sandbox.create({ name: `cmd-${randomUUID().slice(0, 8)}` });
  });
  afterAll(async () => {
    await sandbox.stop();
  });

  test("finished command exposes metadata", async () => {
    const result = await sandbox.runCommand("echo", ["meta"]);
    expect(result.exitCode).toBe(0);
    expect(typeof result.startedAt).toBe("number");
    expect(typeof result.cmdId).toBe("string");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("separates stdout and stderr", async () => {
    const result = await sandbox.runCommand("sh", ["-c", "echo out; echo err >&2"]);
    expect(await result.stdout()).toContain("out");
    expect(await result.stderr()).toContain("err");
    expect(await result.output()).toContain("out");
  });

  test("non-zero exit codes propagate", async () => {
    const result = await sandbox.runCommand("sh", ["-c", "exit 3"]);
    expect(result.exitCode).toBe(3);
  });

  test("stdout is streamed to a provided Writable", async () => {
    const chunks: string[] = [];
    const writable = new (await import("node:stream")).Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    await sandbox.runCommand({ cmd: "echo", args: ["piped"], stdout: writable });
    expect(chunks.join("")).toContain("piped");
  });
});
