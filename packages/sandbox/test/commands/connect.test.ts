import { describe, test, expect, vi, beforeEach } from "vitest";
import * as cmd from "cmd-ts";

const { mockGet, mockCreate, mockFork, mockStartInteractiveShell } = vi.hoisted(
  () => ({
    mockGet: vi.fn(),
    mockCreate: vi.fn(),
    mockFork: vi.fn(),
    mockStartInteractiveShell: vi.fn(),
  }),
);

vi.mock("../../src/client", () => ({
  sandboxClient: {
    get: mockGet,
    create: mockCreate,
    fork: mockFork,
    list: vi.fn(),
  },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
}));

vi.mock("../../src/interactive-shell/interactive-shell", () => ({
  startInteractiveShell: mockStartInteractiveShell,
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

vi.mock("../../src/commands/login", () => ({
  login: { handler: vi.fn() },
}));

const fakeSandbox = {
  name: "my-sandbox",
  interactivePort: 8443,
  routes: [{ url: "https://example.com", subdomain: "sbx", port: 8443 }],
};

const scopeArgs = ["--scope=team", "--project=proj"];

describe("connecting to a sandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(fakeSandbox);
    mockCreate.mockResolvedValue(fakeSandbox);
    mockFork.mockResolvedValue(fakeSandbox);
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  test("`connect` leaves the command to the sandbox", async () => {
    const { connect } = await import("../../src/commands/connect.ts");
    await cmd.run(connect, ["my-sandbox", ...scopeArgs]);

    expect(mockStartInteractiveShell).toHaveBeenCalledTimes(1);
    expect(mockStartInteractiveShell.mock.calls[0][0]).toMatchObject({
      sandbox: fakeSandbox,
      execution: undefined,
      sudo: false,
    });
  });

  test("`connect --sudo` still leaves the command to the sandbox", async () => {
    const { connect } = await import("../../src/commands/connect.ts");
    await cmd.run(connect, ["my-sandbox", "--sudo", ...scopeArgs]);

    expect(mockStartInteractiveShell.mock.calls[0][0]).toMatchObject({
      execution: undefined,
      sudo: true,
    });
  });

  test("`create --connect` leaves the command to the sandbox", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, ["--connect", "--silent", ...scopeArgs]);

    expect(mockStartInteractiveShell).toHaveBeenCalledTimes(1);
    expect(mockStartInteractiveShell.mock.calls[0][0]).toMatchObject({
      sandbox: fakeSandbox,
      execution: undefined,
    });
  });

  test("`fork --connect` leaves the command to the sandbox", async () => {
    const { fork } = await import("../../src/commands/fork.ts");
    await cmd.run(fork, ["my-source", "--connect", "--silent", ...scopeArgs]);

    expect(mockStartInteractiveShell).toHaveBeenCalledTimes(1);
    expect(mockStartInteractiveShell.mock.calls[0][0]).toMatchObject({
      sandbox: fakeSandbox,
      execution: undefined,
    });
  });

  // `--interactive` refuses to parse without a TTY, so this drives the shared
  // entry point the `exec` command hands its parsed arguments to.
  test("`exec --interactive` keeps running the command it was given", async () => {
    const { execute } = await import("../../src/commands/exec.ts");
    await execute({
      sandbox: "my-sandbox",
      command: "npm",
      args: ["test"],
      asSudo: false,
      interactive: true,
      skipExtendingTimeout: false,
      cwd: undefined,
      envVars: {},
      timeout: undefined,
      scope: { token: "tok", team: "team", project: "proj" },
    });

    expect(mockStartInteractiveShell.mock.calls[0][0]).toMatchObject({
      execution: ["npm", "test"],
    });
  });
});
