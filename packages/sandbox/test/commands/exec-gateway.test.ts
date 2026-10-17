import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  prepare: vi.fn(),
  shell: vi.fn(),
}));
vi.mock("../../src/client", () => ({ sandboxClient: { get: mocks.get } }));
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
import { gatewayTags } from "../../src/util/agent-gateway/policy";
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
  });
  test("preserves custom firewall rules without using incomplete readback", async () => {
    const update = vi.fn();
    const readPolicy = vi.fn(() => {
      throw new Error("incomplete policy");
    });
    mocks.get.mockResolvedValue({
      tags: gatewayTags({}, "codex"),
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
    expect(mocks.shell).toHaveBeenCalledOnce();
  });
  test("resumes managed sessions before preparing files without reading a local key", async () => {
    const running = { tags: gatewayTags({}, "all") };
    mocks.get
      .mockResolvedValueOnce({ tags: running.tags })
      .mockResolvedValueOnce(running);
    await exec.handler(input);
    expect(mocks.prepare).toHaveBeenCalledWith(running, "codex");
    expect(mocks.get.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.prepare.mock.invocationCallOrder[0],
    );
    expect(mocks.shell).toHaveBeenCalledOnce();
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
});
