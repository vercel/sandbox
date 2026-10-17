import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import { gatewayKeyFingerprint } from "../../src/util/agent-gateway/policy";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  key: vi.fn(),
  prepare: vi.fn(),
  exec: vi.fn(),
  tty: vi.fn(),
}));
vi.mock("node:tty", () => ({ isatty: mocks.tty }));
vi.mock("../../src/client", () => ({
  sandboxClient: { create: mocks.create, get: vi.fn() },
}));
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));
vi.mock("../../src/commands/login", () => ({ login: { handler: vi.fn() } }));
vi.mock("../../src/util/agent-gateway/credentials", () => ({
  resolveGatewayKey: mocks.key,
}));
vi.mock("../../src/util/agent-gateway/config", () => ({
  prepareAgent: mocks.prepare,
}));
vi.mock("../../src/util/check-latest-version", () => ({
  startLatestVersionCheck: () => ({ report: vi.fn() }),
}));
vi.mock("../../src/commands/exec", async (load) => ({
  ...(await load<typeof import("../../src/commands/exec")>()),
  exec: { handler: mocks.exec },
}));
async function create(args: string[], silent = true) {
  const { create } = await import("../../src/commands/create");
  return cmd.runSafely(create, [
    ...args,
    "--scope=team",
    "--project=project",
    ...(silent ? ["--silent"] : []),
  ]);
}
describe("create --ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_AUTH_TOKEN", "host-vercel-token");
    mocks.tty.mockReturnValue(true);
    mocks.key.mockResolvedValue("host-gateway-secret");
    mocks.create.mockImplementation(async (args) => ({
      name: "test",
      interactivePort: 8443,
      tags: args.tags,
      routes: [],
      region: "iad1",
      runCommand: vi.fn().mockResolvedValue({ exitCode: 0 }),
    }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  test.each(["codex", "claude", "opencode", "pi"])(
    "configures %s after create and before launching, with external auth",
    async (agent) => {
      expect((await create(["--ai", agent]))._tag).toBe("ok");
      expect(mocks.key).not.toHaveBeenCalled();
      const input = mocks.create.mock.calls[0][0];
      expect(input.image).toBe("vercel/sandbox/universal");
      expect(input.tags["sandbox-ai"]).toBe(`v3:${agent}:managed`);
      expect(input.enableAiGateway).toBe(true);
      expect(input.networkPolicy).toBe("allow-all");
      expect(JSON.stringify(input.env)).not.toContain("host-gateway-secret");
      expect(mocks.prepare).toHaveBeenCalledOnce();
      expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.exec.mock.invocationCallOrder[0],
      );
      expect(JSON.stringify(mocks.exec.mock.calls)).not.toContain(
        "host-gateway-secret",
      );
    },
  );
  test("accepts flag after the agent too", async () => {
    expect((await create(["codex", "--ai"]))._tag).toBe("ok");
  });
  test("custom images get managed Gateway access without agent configuration", async () => {
    mocks.key.mockResolvedValue(undefined);
    expect(
      (
        await create([
          "--ai",
          "--image=my-team/my-app:stable",
          "--env=HOME=/app",
        ])
      )._tag,
    ).toBe("ok");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "my-team/my-app:stable",
        enableAiGateway: true,
        tags: { "sandbox-ai": "v3:none:managed" },
        env: {
          HOME: "/app",
          AI_GATEWAY_API_KEY: "sandbox-firewall-credential",
        },
      }),
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  test("custom images keep their selected image with caller-owned firewall credentials", async () => {
    await create(["--ai", "--use-gateway-key", "--image=my-team/my-app"]);
    const request = mocks.create.mock.calls[0][0];
    expect(request.image).toBe("my-team/my-app");
    expect(request.enableAiGateway).toBeUndefined();
    expect(request.tags["sandbox-ai"]).toBe(
      `v2:none:${gatewayKeyFingerprint("host-gateway-secret")}`,
    );
    expect(JSON.stringify(request.networkPolicy)).toContain(
      "host-gateway-secret",
    );
    expect(request.env).toEqual({
      AI_GATEWAY_API_KEY: "sandbox-firewall-credential",
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  test.each([
    "vercel/sandbox/universal",
    "vercel/sandbox/universal:latest",
    "vcr.vercel.com/vercel/sandbox/universal:latest",
    `vercel/sandbox/universal@sha256:${"a".repeat(64)}`,
    `vcr.vercel.com/vercel/sandbox/universal@sha256:${"a".repeat(64)}`,
  ])("explicit universal image %s prepares all agents", async (image) => {
    await create(["--ai", `--image=${image}`]);
    expect(mocks.create.mock.calls[0][0].image).toBe(image);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), "all");
  });
  test.each([
    "vercel/sandbox/universal-custom",
    "my-team/universal",
    "vercel/sandbox/universal/other",
    "vcr.vercel.com.example.com/vercel/sandbox/universal",
    "example.com/vercel/sandbox/universal",
  ])("does not configure agents for lookalike image %s", async (image) => {
    await create(["--ai", `--image=${image}`]);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  test("an explicit universal image can launch the selected agent", async () => {
    await create(["--ai", "codex", "--image=vercel/sandbox/universal:latest"]);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), "codex");
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  test.each([
    ["--ai", "codex", "--image=my-team/my-app"],
    ["--ai", "--image=my-team/my-app", "--env=AI_GATEWAY_API_KEY=secret"],
    ["--ai", "--image=my-team/my-app", "--network-policy=deny-all"],
  ])(
    "rejects incompatible custom setup before allocation: %j",
    async (...args) => {
      await expect(create(args as string[])).rejects.toThrow();
      expect(mocks.key).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  test.each([
    ["--ai", "--runtime=node24"],
    ["--ai", "codex", "--network-policy=deny-all"],
    ["--ai", "codex", "--env=AI_GATEWAY_API_KEY=secret"],
  ])(
    "rejects invalid setup before credentials or VM allocation: %j",
    async (...values) => {
      const args = values as unknown as string[];
      await expect(create(args)).rejects.toThrow();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.key).not.toHaveBeenCalled();
    },
  );
  test("keeps ordinary launcher authentication unchanged", async () => {
    expect((await create(["codex"]))._tag).toBe("ok");
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  test("bare --ai prepares every harness without requiring a terminal or launching one", async () => {
    mocks.tty.mockReturnValue(false);
    mocks.key.mockResolvedValue(undefined);
    expect((await create(["--ai"]))._tag).toBe("ok");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "vercel/sandbox/universal",
        enableAiGateway: true,
        tags: { "sandbox-ai": "v3:all:managed" },
        networkPolicy: "allow-all",
      }),
    );
    expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), "all");
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  test("requests a managed key for the selected agent", async () => {
    mocks.key.mockResolvedValue(undefined);
    await create(["--ai", "codex"]);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        enableAiGateway: true,
        tags: { "sandbox-ai": "v3:codex:managed" },
      }),
    );
    expect(mocks.prepare).toHaveBeenCalledWith(expect.anything(), "codex");
    expect(mocks.exec).toHaveBeenCalledOnce();
  });
  test("reports the retained sandbox when setup fails", async () => {
    mocks.prepare.mockRejectedValueOnce(
      new Error("sensitive implementation detail"),
    );
    await expect(create(["--ai", "pi"])).rejects.toThrow(/sandbox test/);
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  test("ignores host and saved keys in managed mode", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "local-secret");
    mocks.key.mockResolvedValue("saved-secret");
    await create(["--ai"]);
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ enableAiGateway: true }),
    );
    expect(JSON.stringify(mocks.create.mock.calls)).not.toMatch(
      /local-secret|saved-secret/,
    );
  });
  test("explicit reuse resolves a key without prompting and leaves it outside the VM", async () => {
    await create(["--ai", "--use-gateway-key", "codex"]);
    expect(mocks.key).toHaveBeenCalledWith(expect.anything(), {
      durationMs: 24 * 60 * 60 * 1000,
      optional: true,
    });
    const input = mocks.create.mock.calls[0][0];
    expect(input.enableAiGateway).toBeUndefined();
    expect(JSON.stringify(input.networkPolicy)).toContain(
      "host-gateway-secret",
    );
    expect(JSON.stringify(input.env)).not.toContain("host-gateway-secret");
    expect(input.tags["sandbox-ai"]).toBe(
      `v2:codex:${gatewayKeyFingerprint("host-gateway-secret")}`,
    );
  });
  test("explicit reuse without a configured key fails before allocation", async () => {
    mocks.key.mockResolvedValueOnce(undefined);
    await expect(create(["--ai", "--use-gateway-key"])).rejects.toThrow(
      /sandbox gateway setup/,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  test("explicit reuse requires --ai", async () => {
    await expect(create(["--use-gateway-key"])).rejects.toThrow(
      /requires --ai/,
    );
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  test("a rejected personal key never falls back to managed issuance", async () => {
    mocks.key.mockRejectedValueOnce(new Error("Gateway rejected the key"));
    await expect(create(["--ai", "--use-gateway-key"])).rejects.toThrow(
      /Gateway rejected/,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  test("explicit reuse rejects a secret passed through --env", async () => {
    await expect(
      create([
        "--ai",
        "--use-gateway-key",
        "--env=MY_SECRET=host-gateway-secret",
      ]),
    ).rejects.toThrow(/Do not pass the Gateway key/);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  test("managed failure preserves the API error without falling back or reporting success", async () => {
    const error = new Error("Managed AI Gateway is not enabled for this team");
    mocks.create.mockRejectedValueOnce(error);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await expect(create(["--ai"], false)).rejects.toBe(error);
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map(([text]) => text).join("")).not.toContain(
      "AI Gateway enabled",
    );
  });
  test.each([
    [
      [],
      "AI Gateway enabled with a managed session key. Cleanup will revoke it when this session ends.",
    ],
    [
      ["--use-gateway-key"],
      "AI Gateway enabled with your own key. Stopping this sandbox will not revoke it.",
    ],
  ])(
    "reports credential mode on stderr after setup: %j",
    async (extra, message) => {
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      await create(["--ai", ...extra], false);
      const statusIndex = stderr.mock.calls.findIndex(([text]) =>
        String(text).includes(message),
      );
      expect(statusIndex).toBeGreaterThanOrEqual(0);
      expect(stderr.mock.invocationCallOrder[statusIndex]).toBeGreaterThan(
        mocks.prepare.mock.invocationCallOrder[0],
      );
      expect(stdout.mock.calls.map(([text]) => text).join("")).toBe("test");
      expect(stderr.mock.calls.map(([text]) => text).join("")).not.toContain(
        "host-gateway-secret",
      );
    },
  );
  test("--silent suppresses the Gateway status", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await create(["--ai"]);
    expect(stderr.mock.calls.map(([text]) => text).join("")).not.toContain(
      "AI Gateway enabled",
    );
  });
  test("configuration failure does not print Gateway success", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mocks.prepare.mockRejectedValueOnce(new Error("failed"));
    await expect(create(["--ai"], false)).rejects.toThrow(
      /configuration failed/,
    );
    expect(stderr.mock.calls.map(([text]) => text).join("")).not.toContain(
      "AI Gateway enabled",
    );
  });
});
