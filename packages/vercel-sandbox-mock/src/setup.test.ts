import { afterEach, describe, expect, test } from "vitest";
import { Sandbox } from "./sandbox";
import { command, setupSandbox } from "./index";

describe("command stubbing", () => {
  const server = setupSandbox();
  afterEach(() => server.resetHandlers());

  test("a default handler overrides just-bash for a matching command", async () => {
    setupSandbox(command("npm install", { stdout: "installed\n" }));
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("npm", ["install"]);
    expect(await result.stdout()).toContain("installed");
    await sandbox.stop();
  });

  test("a regex handler can compute a response from args", async () => {
    setupSandbox(
      command(/^echo-json/, (args) => ({ stdout: JSON.stringify(args), exitCode: 0 })),
    );
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo-json", ["a", "b"]);
    expect(JSON.parse(await result.stdout())).toEqual(["a", "b"]);
    await sandbox.stop();
  });

  test("use() registers a per-test handler", async () => {
    server.use(command("deploy", { stdout: "deployed\n" }));
    const sandbox = await Sandbox.create();
    expect(await (await sandbox.runCommand("deploy", [])).stdout()).toContain("deployed");
    await sandbox.stop();
  });

  test("resetHandlers restores real execution", async () => {
    setupSandbox(command("echo", { stdout: "stubbed\n" }));
    server.resetHandlers();
    const sandbox = await Sandbox.create();
    // With the stub cleared, the real just-bash `echo` runs again.
    expect(await (await sandbox.runCommand("echo", ["real"])).stdout()).toBe("real\n");
    await sandbox.stop();
  });
});
