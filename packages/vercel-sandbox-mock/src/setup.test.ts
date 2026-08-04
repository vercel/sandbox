import { afterEach, describe, expect, test } from "vitest";
import { Sandbox } from "./sandbox";
import { command, setupSandbox } from "./index";

describe("command stubbing", () => {
  // Baseline handlers registered once, MSW-style, so `resetHandlers` must
  // preserve them across tests.
  const server = setupSandbox(command("npm install", { stdout: "installed\n" }));
  afterEach(() => server.resetHandlers());

  test("a default handler overrides just-bash for a matching command", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("npm", ["install"]);
    expect(await result.stdout()).toContain("installed");
    await sandbox.stop();
  });

  test("use() registers a per-test handler that takes priority", async () => {
    server.use(command("deploy", { stdout: "deployed\n" }));
    const sandbox = await Sandbox.create();
    expect(await (await sandbox.runCommand("deploy", [])).stdout()).toContain("deployed");
    await sandbox.stop();
  });

  test("a regex handler can compute a response from args", async () => {
    server.use(
      command(/^echo-json/, (args) => ({ stdout: JSON.stringify(args), exitCode: 0 })),
    );
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo-json", ["a", "b"]);
    expect(JSON.parse(await result.stdout())).toEqual(["a", "b"]);
    await sandbox.stop();
  });

  test("resetHandlers drops use() overrides but keeps the baseline defaults", async () => {
    server.use(command("npm install", { stdout: "overridden\n" }));
    server.resetHandlers();
    const sandbox = await Sandbox.create();
    // The per-test override is gone, but the module-scope default persists.
    expect(await (await sandbox.runCommand("npm", ["install"])).stdout()).toContain("installed");
    await sandbox.stop();
  });

  test("use() overrides fall away after reset, restoring real execution", async () => {
    server.use(command("echo", { stdout: "stubbed\n" }));
    server.resetHandlers();
    const sandbox = await Sandbox.create();
    // With the override cleared and no baseline stub for `echo`, real
    // just-bash `echo` runs again.
    expect(await (await sandbox.runCommand("echo", ["real"])).stdout()).toBe("real\n");
    await sandbox.stop();
  });
});
