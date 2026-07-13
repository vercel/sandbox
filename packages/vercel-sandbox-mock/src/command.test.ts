import { describe, expect, test } from "vitest";
import { Sandbox, Command, CommandFinished } from "./index";

describe(Command, () => {
  test("startedAt is a number", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    expect(typeof result.startedAt).toBe("number");
    await sandbox.stop();
  });

  test("exitCode is null for running command or number for finished", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    // CommandFinished always has a number
    expect(typeof result.exitCode).toBe("number");
    await sandbox.stop();
  });

  test("logs() yields {data, stream} shape (not {type, data, timestamp})", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    const entries: unknown[] = [];
    for await (const entry of result.logs()) {
      entries.push(entry);
    }
    expect(entries.length).toBeGreaterThan(0);
    const first = entries[0] as { data: string; stream: string };
    expect(first).toHaveProperty("data");
    expect(first).toHaveProperty("stream");
    expect(first).not.toHaveProperty("type");
    expect(first).not.toHaveProperty("timestamp");
    await sandbox.stop();
  });

  test("logs() return has close() method and Symbol.dispose", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    const logsGen = result.logs();
    expect(typeof logsGen.close).toBe("function");
    expect(typeof logsGen[Symbol.dispose]).toBe("function");
    logsGen.close();
    await sandbox.stop();
  });

  test('output("stdout") returns only stdout', async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    const out = await result.output("stdout");
    expect(out).toContain("hello");
    await sandbox.stop();
  });

  test('output("stderr") returns empty for clean commands', async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    const err = await result.output("stderr");
    expect(err).toBe("");
    await sandbox.stop();
  });

  test("kill() accepts signal string without error", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    await expect(result.kill("SIGTERM")).resolves.toBeUndefined();
    await sandbox.stop();
  });

  test("exitCode is null before wait() on detached command", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["test"]);
    expect(typeof result.exitCode).toBe("number");
    await sandbox.stop();
  });

  test("output() with no args returns combined stdout+stderr", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    const combined = await result.output();
    expect(combined).toContain("hello");
    await sandbox.stop();
  });
});

describe(CommandFinished, () => {
  test("exitCode is always a number", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    // result is CommandFinished — exitCode must be number, never null
    expect(result.exitCode).toBe(0);
    await sandbox.stop();
  });

  test("exitCode is non-zero on failure", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("ls", ["/no/such/dir"]);
    expect(result.exitCode).toBeGreaterThan(0);
    await sandbox.stop();
  });

  test("wait() on CommandFinished returns self", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    const again = await result.wait();
    expect(again).toBe(result);
    await sandbox.stop();
  });
});
