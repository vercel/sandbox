import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    create: vi.fn(),
    fork: vi.fn(),
    get: mockGet,
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

describe("run command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  test("rejects runtime and image before looking up a named sandbox", async () => {
    const { run } = await import("../../src/commands/run.ts");

    await expect(
      cmd.run(run, [
        "echo",
        "--name=existing",
        "--runtime=node24",
        "--image=test-image",
        "--scope=team",
        "--project=proj",
      ]),
    ).rejects.toThrow("--runtime and --image cannot be used together.");

    expect(mockGet).not.toHaveBeenCalled();
  });
});
