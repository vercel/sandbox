import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";
import type { APIClient, CommandData, SandboxMetaData } from "./api-client";
import { APIError } from "./api-client/api-error";
import { Sandbox } from "./sandbox";

const makeSandboxMetadata = (): SandboxMetaData => ({
  id: "sbx_123",
  memory: 2048,
  vcpus: 1,
  region: "iad1",
  runtime: "node24",
  timeout: 300_000,
  status: "running",
  requestedAt: 1,
  createdAt: 1,
  cwd: "/",
  updatedAt: 1,
});

const makeCommand = (): CommandData => ({
  id: "cmd_123",
  name: "echo",
  args: ["hello"],
  cwd: "/",
  sandboxId: "sbx_123",
  exitCode: null,
  startedAt: 1,
});

describe("Sandbox _runCommand", () => {
  it("rejects non-detached runCommand when log streaming fails", async () => {
    const command = makeCommand();
    const logsError = new APIError(new Response("failed", { status: 500 }), {
      message: "Failed to stream logs",
      sandboxId: "sbx_123",
    });

    const runCommandMock = vi.fn(async ({ wait }: { wait?: boolean }) => {
      if (wait) {
        return {
          command,
          finished: Promise.resolve({ ...command, exitCode: 0 }),
        };
      }

      return { json: { command } };
    });

    const getLogsMock = vi.fn(() =>
      (async function* () {
        throw logsError;
      })(),
    );

    const sandbox = new Sandbox({
      client: {
        runCommand: runCommandMock,
        getLogs: getLogsMock,
      } as unknown as APIClient,
      routes: [],
      sandbox: makeSandboxMetadata(),
    });

    await expect(
      sandbox.runCommand({
        cmd: "echo",
        args: ["hello"],
        stdout: new PassThrough(),
      }),
    ).rejects.toBe(logsError);
  });

  it("emits detached log streaming errors on the provided output stream", async () => {
    const command = makeCommand();
    const logsError = new APIError(new Response("failed", { status: 500 }), {
      message: "Failed to stream logs",
      sandboxId: "sbx_123",
    });

    const runCommandMock = vi.fn(async ({ wait }: { wait?: boolean }) => {
      if (wait) {
        return {
          command,
          finished: Promise.resolve({ ...command, exitCode: 0 }),
        };
      }

      return { json: { command } };
    });

    const getLogsMock = vi.fn(() =>
      (async function* () {
        throw logsError;
      })(),
    );

    const sandbox = new Sandbox({
      client: {
        runCommand: runCommandMock,
        getLogs: getLogsMock,
      } as unknown as APIClient,
      routes: [],
      sandbox: makeSandboxMetadata(),
    });

    const stdout = new PassThrough();
    const errorEvent = new Promise<unknown>((resolve) => {
      stdout.once("error", resolve);
    });

    const detached = await sandbox.runCommand({
      cmd: "echo",
      args: ["hello"],
      detached: true,
      stdout,
    });

    expect(detached.cmdId).toBe("cmd_123");
    await expect(errorEvent).resolves.toBe(logsError);
  });
});
