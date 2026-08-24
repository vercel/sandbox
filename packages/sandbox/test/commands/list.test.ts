import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    get: vi.fn(),
    create: vi.fn(),
    fork: vi.fn(),
    list: mockList,
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

describe("list command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    process.env.VERCEL_AUTH_TOKEN = "tok";
    mockList.mockResolvedValue({
      sandboxes: [],
      pagination: { count: 0, next: null },
    });
  });

  test("passes a single tag filter to the client", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { list } = await import("../../src/commands/list.ts");

    await cmd.run(list, [
      "--tag=env=staging",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockList).toHaveBeenCalledOnce();
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ tags: { env: "staging" } }),
    );
    log.mockRestore();
  });

  test("rejects multiple tag filters before calling the API", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { list } = await import("../../src/commands/list.ts");

    await cmd.run(list, [
      "--tag=env=staging",
      "--tag=team=infra",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockList).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("only one --tag filter is supported"),
    );
    expect(process.exitCode).toBe(1);
    error.mockRestore();
  });
});
