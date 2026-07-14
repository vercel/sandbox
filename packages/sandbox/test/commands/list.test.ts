import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as cmd from "cmd-ts";

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    fork: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
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

const emptyPage = { sandboxes: [], pagination: { count: 0, next: null } };

describe("list command", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(emptyPage);
    process.env.VERCEL_AUTH_TOKEN = "tok";
    vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = async (args: string[]) => {
    const { list } = await import("../../src/commands/list.ts");
    return cmd.run(list, ["--scope=team", "--project=proj", ...args]);
  };

  test("defaults to filtering running at the API level", async () => {
    await run([]);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList.mock.calls[0][0].status).toBe("running");
  });

  test("forwards an explicit --status to the API", async () => {
    await run(["--status", "stopped"]);
    expect(mockList.mock.calls[0][0].status).toBe("stopped");
  });

  test("--all sends no status filter", async () => {
    await run(["--all"]);
    expect(mockList.mock.calls[0][0].status).toBeUndefined();
  });

  test("does not send a status when --tag is used", async () => {
    await run(["--tag", "env=staging"]);
    expect(mockList.mock.calls[0][0].status).toBeUndefined();
    expect(mockList.mock.calls[0][0].tags).toEqual({ env: "staging" });
  });

  test("errors when --status is combined with --tag", async () => {
    await run(["--status", "running", "--tag", "env=staging"]);
    expect(mockList).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("errors when --status is combined with --all", async () => {
    await run(["--status", "running", "--all"]);
    expect(mockList).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
