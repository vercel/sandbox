import { afterEach, describe, expect, test } from "vitest";
import { Sandbox, setupSandbox, command } from "./index";

// Regression coverage for handler-backed commands across the three runCommand
// shapes, including detached mode, so a matched handler returns a working
// Command whose logs()/wait()/stdout() resolve to the handler's output.
describe("command handlers via runCommand", () => {
  const server = setupSandbox(
    command("mycmd", { stdout: "handler output\n", exitCode: 0 }),
  );

  afterEach(() => server.resetHandlers());

  test("string form: runCommand('mycmd')", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("mycmd");
    expect(await result.stdout()).toBe("handler output\n");
    expect(result.exitCode).toBe(0);
    await sandbox.stop();
  });

  test("object form: runCommand({ cmd: 'mycmd' })", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand({ cmd: "mycmd" });
    expect(await result.stdout()).toBe("handler output\n");
    expect(result.exitCode).toBe(0);
    await sandbox.stop();
  });

  test("detached form: runCommand({ cmd: 'mycmd', detached: true })", async () => {
    const sandbox = await Sandbox.create();
    const cmd = await sandbox.runCommand({ cmd: "mycmd", detached: true });

    // The returned handle behaves like a live command.
    const finished = await cmd.wait();
    expect(await finished.stdout()).toBe("handler output\n");
    expect(finished.exitCode).toBe(0);
    expect(typeof finished.durationMs).toBe("number");

    await sandbox.stop();
  });

  test("detached handler streams via logs()", async () => {
    const sandbox = await Sandbox.create();
    const cmd = await sandbox.runCommand({ cmd: "mycmd", detached: true });

    let streamed = "";
    for await (const msg of cmd.logs()) {
      if (msg.stream === "stdout") streamed += msg.data;
    }
    expect(streamed).toBe("handler output\n");

    // The command is retrievable by id while the session is alive.
    const same = await sandbox.getCommand(cmd.cmdId);
    expect(same.cmdId).toBe(cmd.cmdId);

    await sandbox.stop();
  });
});
