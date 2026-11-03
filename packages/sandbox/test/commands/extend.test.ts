import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockGet, mockExtendTimeout } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockExtendTimeout: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: { get: mockGet },
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

const args = ["my-sandbox", "3m", "--scope=team", "--project=proj"];

describe("extend command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_AUTH_TOKEN = "tok";
    mockGet.mockResolvedValue({
      currentSession: () => ({
        status: "running",
        extendTimeout: mockExtendTimeout,
      }),
    });
  });

  test("adds time to the active session without changing the sandbox config", async () => {
    const { extend } = await import("../../src/commands/extend.ts");
    await cmd.run(extend, args);

    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "my-sandbox", resume: false }),
    );
    expect(mockExtendTimeout).toHaveBeenCalledWith(180_000);
  });

  test("does not resume or extend a stopped session", async () => {
    mockGet.mockResolvedValue({
      currentSession: () => ({
        status: "stopped",
        extendTimeout: mockExtendTimeout,
      }),
    });
    const { extend } = await import("../../src/commands/extend.ts");

    await expect(cmd.run(extend, args)).rejects.toThrow("no running session");
    expect(mockExtendTimeout).not.toHaveBeenCalled();
  });

  test("rejects a zero duration before fetching the sandbox", async () => {
    const { extend } = await import("../../src/commands/extend.ts");
    await expect(
      cmd.run(extend, ["my-sandbox", "0m", "--scope=team", "--project=proj"]),
    ).rejects.toThrow("greater than zero");
    expect(mockGet).not.toHaveBeenCalled();
  });
});
