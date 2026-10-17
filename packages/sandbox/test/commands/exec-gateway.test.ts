import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  key: vi.fn(),
  prepare: vi.fn(),
  shell: vi.fn(),
}));
vi.mock("../../src/client", () => ({ sandboxClient: { get: mocks.get } }));
vi.mock("../../src/util/agent-gateway/credentials", () => ({
  resolveGatewayKey: mocks.key,
}));
vi.mock("../../src/util/agent-gateway/config", () => ({
  prepareAgent: mocks.prepare,
}));
vi.mock("../../src/interactive-shell/interactive-shell", () => ({
  startInteractiveShell: mocks.shell,
}));
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));
vi.mock("../../src/commands/login", () => ({ login: { handler: vi.fn() } }));
import { exec } from "../../src/commands/exec";
import { run } from "../../src/commands/run";
import {
  gatewayPolicy,
  gatewayTags,
  gatewayKeyFingerprint,
} from "../../src/util/agent-gateway/policy";
const input = {
  command: "codex",
  args: ["resume", "--last", "--no-daemon"],
  sandbox: "test",
  scope: { token: "vercel-token", team: "team", project: "project" },
  asSudo: false,
  cwd: undefined,
  interactive: true,
  tty: true,
  skipExtendingTimeout: false,
  envVars: {},
  timeout: undefined,
};
describe("Gateway reconnect", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.key.mockResolvedValue("new-secret");
  });
  test("validates the bound key before resuming and preserves the firewall", async () => {
    const order: string[] = [];
    const sandbox = {
      tags: gatewayTags({}, "codex", "new-secret"),
      networkPolicy: gatewayPolicy("allow-all", "old"),
      update: vi.fn(async () => {
        order.push("update");
      }),
    };
    mocks.get.mockImplementation(async ({ resume }) => {
      order.push(resume ? "resume" : "get");
      return sandbox;
    });
    mocks.key.mockResolvedValue("new-secret");
    mocks.prepare.mockImplementation(async () => {
      order.push("prepare");
    });
    await exec.handler(input);
    expect(order).toEqual(["get", "resume", "prepare"]);
    expect(sandbox.update).not.toHaveBeenCalled();
    expect(mocks.key).toHaveBeenCalledWith(
      input.scope,
      expect.objectContaining({
        fingerprint: gatewayKeyFingerprint("new-secret"),
      }),
    );
    expect(JSON.stringify(mocks.shell.mock.calls)).not.toContain("new-secret");
    expect(mocks.shell).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: { AI_GATEWAY_API_KEY: "sandbox-firewall-credential" },
      }),
    );
  });
  test("never resumes or launches when credentials fail", async () => {
    mocks.get.mockResolvedValue({
      tags: gatewayTags({}, "pi", "new-secret"),
      networkPolicy: gatewayPolicy("allow-all", "old"),
    });
    mocks.key.mockRejectedValue(new Error("expired"));
    await expect(exec.handler(input)).rejects.toThrow("expired");
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.shell).not.toHaveBeenCalled();
  });
  test("preserves custom firewall rules without using incomplete readback", async () => {
    const update = vi.fn();
    const readPolicy = vi.fn(() => {
      throw new Error("incomplete policy");
    });
    mocks.get.mockResolvedValue({
      tags: gatewayTags({}, "codex", "new-secret"),
      get networkPolicy() {
        return readPolicy();
      },
      update,
    });
    await exec.handler(input);
    expect(readPolicy).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(mocks.shell).toHaveBeenCalledOnce();
  });
  test("does not acquire Gateway credentials for ordinary sandboxes", async () => {
    mocks.get.mockResolvedValue({});
    await exec.handler(input);
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.shell).toHaveBeenCalledOnce();
  });
  test("resumes managed sessions before preparing files without reading a local key", async () => {
    const running = { tags: gatewayTags({}, "all") };
    mocks.get
      .mockResolvedValueOnce({ tags: running.tags })
      .mockResolvedValueOnce(running);
    await exec.handler(input);
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledWith(running, "codex");
    expect(mocks.get.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.prepare.mock.invocationCallOrder[0],
    );
    expect(mocks.shell).toHaveBeenCalledOnce();
  });
  test("run --name validates credentials before resuming a stopped sandbox", async () => {
    mocks.get.mockResolvedValue({
      tags: gatewayTags({}, "codex", "new-secret"),
      networkPolicy: gatewayPolicy("allow-all", "old"),
    });
    mocks.key.mockRejectedValue(new Error("expired"));
    await expect(
      run.handler({
        ...input,
        name: "test",
        removeAfterUse: false,
        stopAfterUse: false,
      } as unknown as Parameters<typeof run.handler>[0]),
    ).rejects.toThrow("expired");
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ resume: false }),
    );
    expect(mocks.shell).not.toHaveBeenCalled();
  });
  test.each(["codex", "claude", "pi", "opencode", "node", "bash"])(
    "Gateway-only reconnect does not configure %s or override app env",
    async (command) => {
      mocks.get.mockResolvedValue({
        tags: { "sandbox-ai": "v3:none:managed" },
      });
      await exec.handler({
        ...input,
        command,
        envVars: { HOME: "/app", ANTHROPIC_BASE_URL: "https://example.com" },
      });
      expect(mocks.key).not.toHaveBeenCalled();
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.shell).toHaveBeenCalledWith(
        expect.objectContaining({
          envVars: {
            HOME: "/app",
            ANTHROPIC_BASE_URL: "https://example.com",
            AI_GATEWAY_API_KEY: "sandbox-firewall-credential",
          },
        }),
      );
    },
  );
  test("Gateway-only caller-owned reconnect validates the original key before resume", async () => {
    mocks.get.mockResolvedValue({
      tags: { "sandbox-ai": `v2:none:${gatewayKeyFingerprint("new-secret")}` },
    });
    mocks.key.mockRejectedValue(new Error("expired"));
    await expect(exec.handler(input)).rejects.toThrow("expired");
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.shell).not.toHaveBeenCalled();
  });
});
