import { expect, it, vi, beforeEach, afterEach, describe } from "vitest";
import { Sandbox } from "./sandbox";
import type { Session } from "./session";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")("Command", () => {
  let sandbox: Sandbox;
  let session: Session;

  beforeEach(async () => {
    sandbox = await Sandbox.create();
    session = sandbox.currentSession();
  });

  afterEach(async () => {
    await session.stop();
  });

  it("supports more than one logs consumer", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const cmd = await session.runCommand({
      cmd: "echo",
      args: ["Hello World!"],
      stdout: process.stdout,
    });

    expect(await cmd.stdout()).toEqual("Hello World!\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Hello World!\n");
  });

  it("does not warn when there is only one logs consumer", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cmd = await session.runCommand({
      cmd: "echo",
      args: ["Hello World!"],
    });

    expect(await cmd.stdout()).toEqual("Hello World!\n");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("Kills a command with a SIGINT", async () => {
    const cmd = await session.runCommand({
      cmd: "sleep",
      args: ["200000"],
      detached: true,
    });

    await cmd.kill("SIGINT");
    const result = await cmd.wait();
    expect(result.exitCode).toBe(130); // 128 + 2
  });

  it("Kills a command with a SIGTERM", async () => {
    const cmd = await session.runCommand({
      cmd: "sleep",
      args: ["200000"],
      detached: true,
    });

    await cmd.kill("SIGTERM");

    const result = await cmd.wait();
    expect(result.exitCode).toBe(143); // 128 + 15
  });

  it("can execute commands with sudo", async () => {
    const cmd = await session.runCommand({
      cmd: "env",
      sudo: true,
      env: {
        FOO: "bar",
      },
    });

    expect(cmd.exitCode).toBe(0);

    const output = await cmd.stdout();
    expect(output).toContain("FOO=bar\n");
    expect(output).toContain("USER=root\n");
    expect(output).toContain("SUDO_USER=vercel-sandbox\n");

    const pathLine = output
      .split("\n")
      .find((line) => line.startsWith("PATH="));
    expect(pathLine).toBeDefined();

    const pathSegments = pathLine!.slice(5).split(":");
    expect(pathSegments).toContain("/vercel/bin");
    expect(pathSegments).toContain("/vercel/runtimes/node22/bin");

    const dnf = await session.runCommand({
      cmd: "dnf",
      args: ["install", "-y", "golang"],
      sudo: true,
    });

    expect(dnf.exitCode).toBe(0);

    const which = await session.runCommand("which", ["go"]);
    expect(await which.output()).toContain("/usr/bin/go");
  });
});
