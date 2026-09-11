import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockGetOrCreate, mockList } = vi.hoisted(() => ({
  mockGetOrCreate: vi.fn(),
  mockList: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  driveClient: {
    getOrCreate: mockGetOrCreate,
    list: mockList,
    delete: vi.fn(),
  },
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

vi.mock("../../src/commands/login", () => ({
  login: { handler: vi.fn() },
}));

const fakeDrive = {
  name: "workspace",
  region: "sfo1",
  maxSize: 1024,
  currentSandboxName: undefined,
  currentSessionId: undefined,
  createdAt: new Date(1),
  updatedAt: new Date(2),
};

describe("drives command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreate.mockResolvedValue(fakeDrive);
    mockList.mockResolvedValue({
      drives: [fakeDrive],
      pagination: { count: 1, next: null },
    });
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("forwards a trimmed --region when creating a drive", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { drives } = await import("../../src/commands/drives.ts");

    await cmd.run(drives, [
      "get-or-create",
      "workspace",
      "--region",
      " sfo1 ",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockGetOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ region: "sfo1" }),
    );
  });

  test("shows the region in the drive list", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { drives } = await import("../../src/commands/drives.ts");

    await cmd.run(drives, ["list", "--scope=team", "--project=proj"]);

    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("REGION");
    expect(output).toContain("sfo1");
  });
});
