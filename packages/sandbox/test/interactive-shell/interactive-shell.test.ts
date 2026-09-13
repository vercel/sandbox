import { describe, test, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import type { Sandbox } from "@vercel/sandbox";
import {
  resolveExecution,
  startInteractiveShell,
} from "../../src/interactive-shell/interactive-shell";

describe("resolveExecution", () => {
  test("asks the sandbox for the account's login shell when no command is given", () => {
    expect(resolveExecution({ execution: undefined, sudo: false })).toEqual({
      // Empty: the sandbox resolves the shell from the account's passwd entry.
      command: "",
      args: ["--login"],
    });
  });

  test("asks sudo for the target account's login shell", () => {
    expect(resolveExecution({ execution: undefined, sudo: true })).toEqual({
      command: "sudo",
      args: ["--login"],
    });
  });

  test("passes an explicit command through untouched", () => {
    expect(
      resolveExecution({ execution: ["npm", "test", "--", "-w"], sudo: false }),
    ).toEqual({ command: "npm", args: ["test", "--", "-w"] });
  });

  test("keeps an explicit command under sudo", () => {
    expect(
      resolveExecution({ execution: ["npm", "test"], sudo: true }),
    ).toEqual({ command: "sudo", args: ["npm", "test"] });
  });
});

/**
 * Runs an interactive session against a local WebSocket server and returns the
 * `start` control frame the client sent, which is the contract the sandbox's
 * interactive server reads.
 */
async function captureStartFrame(options: {
  execution?: [string, ...string[]];
  sudo?: boolean;
}) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  const start = new Promise<Record<string, unknown>>((resolve, reject) => {
    server.once("connection", (socket) => {
      socket.once("message", (data: Buffer) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch (err) {
          reject(err);
        }
        // Ending the session lets startInteractiveShell resolve.
        socket.close();
      });
    });
  });

  const sandbox = {
    name: "my-sandbox",
    cwd: "/vercel/sandbox",
    openInteractive: async () => ({
      url: `ws://127.0.0.1:${port}`,
      token: "session-token",
    }),
  } as unknown as Sandbox;

  try {
    await startInteractiveShell({
      sandbox,
      envVars: { FOO: "bar" },
      sudo: options.sudo ?? false,
      execution: options.execution,
      skipExtendingTimeout: true,
    });
    return await start;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("startInteractiveShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("starts the account's login shell when no command is given", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const frame = await captureStartFrame({});

    expect(frame).toMatchObject({
      type: "start",
      command: "",
      args: ["--login"],
      cwd: "/vercel/sandbox",
    });
    expect(frame.env).toEqual(
      expect.arrayContaining(["TERM=xterm-256color", "FOO=bar"]),
    );
  });

  test("starts an explicit command instead of a shell", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const frame = await captureStartFrame({ execution: ["npm", "test"] });

    expect(frame).toMatchObject({
      type: "start",
      command: "npm",
      args: ["test"],
    });
  });

  test("echoes an explicit command but not the shell the sandbox picks", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    await captureStartFrame({ execution: ["npm", "test"] });
    expect(stderr.mock.calls.flat().join("\n")).toContain("npm test");

    stderr.mockClear();
    await captureStartFrame({});
    expect(stderr.mock.calls.flat().join("\n")).not.toContain("--login");
  });
});
