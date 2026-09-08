import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    create: mockCreate,
    fork: vi.fn(),
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

describe("create command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      name: "my-sandbox",
      interactivePort: 8443,
      routes: [],
    });
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  test("forwards --network-id to Sandbox.create", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, [
      "--network-id=network_123",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ networkId: "network_123" }),
    );
  });
});
