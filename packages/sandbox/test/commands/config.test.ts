import { describe, test, expect, vi, beforeEach } from "vitest";
import * as cmd from "cmd-ts";

const { mockGet, mockUpdate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    get: mockGet,
    create: vi.fn(),
    fork: vi.fn(),
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

const fakeSandbox = (overrides: Record<string, unknown> = {}) => ({
  name: "my-sandbox",
  region: "sfo1",
  failoverRegions: ["iad1", "cle1"],
  vcpus: 2,
  timeout: 300_000,
  persistent: true,
  networkPolicy: "restricted",
  interactivePort: 8443,
  routes: [],
  tags: undefined,
  update: mockUpdate,
  ...overrides,
});

describe("config command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(fakeSandbox());
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  test("region updates the sandbox region", async () => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "region",
      "my-sandbox",
      "cle1",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({ region: "cle1" });
  });

  test("failover-regions splits, trims, and de-duplicates the list", async () => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "failover-regions",
      "my-sandbox",
      "sfo1, iad1,sfo1",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({
      failoverRegions: ["sfo1", "iad1"],
    });
  });

  test('failover-regions "none" clears the failover regions', async () => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "failover-regions",
      "my-sandbox",
      "none",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({ failoverRegions: [] });
  });

  test("list prints the region and the failover regions", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "list",
      "my-sandbox",
      "--scope=team",
      "--project=proj",
    ]);

    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("sfo1");
    expect(output).toContain("iad1, cle1");
    log.mockRestore();
  });

  test("list dashes empty failover regions", async () => {
    mockGet.mockResolvedValue(fakeSandbox({ failoverRegions: [] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "list",
      "my-sandbox",
      "--scope=team",
      "--project=proj",
    ]);

    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toMatch(/Failover regions\s+-/);
    log.mockRestore();
  });
});
