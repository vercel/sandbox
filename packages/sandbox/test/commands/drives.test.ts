import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockGet, mockGetOrCreate, mockList, mockFork } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockGetOrCreate: vi.fn(),
  mockList: vi.fn(),
  mockFork: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  driveClient: {
    get: mockGet,
    getOrCreate: mockGetOrCreate,
    list: mockList,
    delete: vi.fn(),
    fork: mockFork,
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
    mockGet.mockResolvedValue(fakeDrive);
    mockFork.mockResolvedValue({ ...fakeDrive, name: "workspace-fork" });
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

  test("forks an existing drive with trimmed names and the selected scope", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { drives } = await import("../../src/commands/drives.ts");

    await cmd.run(drives, [
      "fork",
      " workspace ",
      " workspace-fork ",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockGet).toHaveBeenCalledWith({
      token: "tok",
      teamId: "team",
      projectId: "proj",
      name: "workspace",
    });
    expect(mockFork).toHaveBeenCalledWith(fakeDrive, {
      name: "workspace-fork",
    });
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    const output = stderr.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("workspace-fork");
    expect(output).toMatch(/forked from:.*workspace/);
    expect(output).toContain("sfo1");
    expect(output).toContain("max size:");
  });

  test("does not create a drive when the source is missing", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGet.mockRejectedValue(new Error("Drive not found."));
    const { drives } = await import("../../src/commands/drives.ts");

    await expect(
      cmd.run(drives, [
        "fork",
        "missing",
        "workspace-fork",
        "--scope=team",
        "--project=proj",
      ]),
    ).rejects.toThrow("Drive not found.");

    expect(mockFork).not.toHaveBeenCalled();
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });

  test("reports a fork failure without printing success", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    mockFork.mockRejectedValue(
      new Error('Drive "workspace-fork" already exists.'),
    );
    const { drives } = await import("../../src/commands/drives.ts");

    await expect(
      cmd.run(drives, [
        "fork",
        "workspace",
        "workspace-fork",
        "--scope=team",
        "--project=proj",
      ]),
    ).rejects.toThrow('Drive "workspace-fork" already exists.');

    const output = stderr.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).not.toContain("✅");
  });
});
