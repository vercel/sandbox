import { describe, test, expect, vi, beforeEach } from "vitest";
import * as cmd from "cmd-ts";

const { mockFork, mockCreate } = vi.hoisted(() => ({
  mockFork: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    fork: mockFork,
    create: mockCreate,
    get: vi.fn(),
    list: vi.fn(),
  },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

vi.mock("../../src/commands/login", () => ({
  login: { handler: vi.fn() },
}));

const fakeSandbox = {
  name: "forked-sandbox",
  interactivePort: 8443,
  routes: [
    { url: "https://example.com", subdomain: "sbx", port: 8443 },
  ],
};

describe("fork command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFork.mockResolvedValue(fakeSandbox);
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  test("passes the positional source to Sandbox.fork", async () => {
    const { fork } = await import("../../src/commands/fork.ts");
    await cmd.run(fork, [
      "my-source",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockFork).toHaveBeenCalledTimes(1);
    const call = mockFork.mock.calls[0][0];
    expect(call.source).toBe("my-source");
    expect(call.teamId).toBe("team");
    expect(call.projectId).toBe("proj");
  });

  test("forwards overrides (name, vcpus, env, tags) to Sandbox.fork", async () => {
    const { fork } = await import("../../src/commands/fork.ts");
    await cmd.run(fork, [
      "my-source",
      "--name=new-name",
      "--vcpus=4",
      "--env",
      "FOO=1",
      "--env",
      "BAR=2",
      "--tag",
      "env=staging",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    const call = mockFork.mock.calls[0][0];
    expect(call.name).toBe("new-name");
    expect(call.resources).toEqual({ vcpus: 4 });
    expect(call.env).toEqual({ FOO: "1", BAR: "2" });
    expect(call.tags).toEqual({ env: "staging" });
  });

  test("does not forward overrides for unspecified options (server uses copied source values)", async () => {
    const { fork } = await import("../../src/commands/fork.ts");
    await cmd.run(fork, [
      "my-source",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    const call = mockFork.mock.calls[0][0];
    expect(call.resources).toBeUndefined();
    expect(call.timeout).toBeUndefined();
    expect(call.networkPolicy).toBeUndefined();
    expect(call.env).toBeUndefined();
    expect(call.tags).toBeUndefined();
    expect(call.snapshotExpiration).toBeUndefined();
    expect(call.keepLastSnapshots).toBeUndefined();
  });

  test("fails when the source positional is missing", async () => {
    const { fork } = await import("../../src/commands/fork.ts");
    await expect(
      cmd.run(fork, ["--scope=team", "--project=proj", "--silent"]),
    ).rejects.toThrow();
    expect(mockFork).not.toHaveBeenCalled();
  });

  test("--non-persistent sets persistent: false override", async () => {
    const { fork } = await import("../../src/commands/fork.ts");
    await cmd.run(fork, [
      "my-source",
      "--non-persistent",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    const call = mockFork.mock.calls[0][0];
    expect(call.persistent).toBe(false);
  });
});

describe("create command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(fakeSandbox);
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  test("rejects the removed --sandbox-snapshot flag", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await expect(
      cmd.run(create, [
        "--sandbox-snapshot=some-sandbox",
        "--scope=team",
        "--project=proj",
        "--silent",
      ]),
    ).rejects.toThrow();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
