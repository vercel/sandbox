import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Sandbox } from "../src/sandbox";
import { command, setupSandbox } from "../src";

describe("Command stdin (real SDK over mock fetch)", () => {
  setupSandbox(
    command("count-lines", (_args, { stdin }) => ({
      stdout: `${stdin.split("\n").filter(Boolean).length}\n`,
    })),
  );
  let sandbox: Sandbox;
  beforeAll(async () => {
    sandbox = await Sandbox.create({
      name: `stdin-${randomUUID().slice(0, 8)}`,
    });
  });
  afterAll(async () => {
    await sandbox.stop();
  });

  test("writeStdin and closeStdin feed a detached command", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "cat",
      detached: true,
      stdin: true,
    });
    await cmd.writeStdin("hello ");
    await cmd.writeStdin(new TextEncoder().encode("world\n"));
    await cmd.closeStdin();

    const result = await cmd.wait();
    expect(result.exitCode).toBe(0);
    expect(await result.stdout()).toBe("hello world\n");
  });

  test("a Readable is piped to a command the caller waits on", async () => {
    const result = await sandbox.runCommand({
      cmd: "count-lines",
      stdin: Readable.from(["a\n", "b\n", "c\n"]),
    });
    expect(await result.stdout()).toBe("3\n");
  });

  test("writing after the command exited rejects", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "cat",
      detached: true,
      stdin: true,
    });
    await cmd.closeStdin();
    await cmd.wait();
    await expect(cmd.writeStdin("late")).rejects.toThrow();
  });

  test("killing a command waiting for stdin ends it", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "cat",
      detached: true,
      stdin: true,
    });
    await cmd.kill();
    expect((await cmd.wait()).exitCode).toBe(143);
  });

  test("wait() honors its abort signal while stdin is open", async () => {
    const cmd = await sandbox.runCommand({
      cmd: "cat",
      detached: true,
      stdin: true,
    });
    await expect(
      cmd.wait({ signal: AbortSignal.timeout(20) }),
    ).rejects.toThrow();
    await cmd.closeStdin();
    expect((await cmd.wait()).exitCode).toBe(0);
  });
});
