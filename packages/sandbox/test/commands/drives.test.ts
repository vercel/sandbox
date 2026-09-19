import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";

const { mockGetOrCreate, mockList, mockShouldPrompt, mockPrompt } = vi.hoisted(
  () => ({
    mockGetOrCreate: vi.fn(),
    mockList: vi.fn(),
    mockShouldPrompt: vi.fn(),
    mockPrompt: vi.fn(),
  }),
);

vi.mock("../../src/util/prompt", () => ({
  shouldPromptForDriveSize: mockShouldPrompt,
  promptDriveSize: mockPrompt,
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
    mockShouldPrompt.mockResolvedValue(false);
    mockPrompt.mockResolvedValue(undefined);
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

  const getOrCreate = (...extra: string[]) =>
    import("../../src/commands/drives.ts").then(({ drives }) =>
      cmd.run(drives, [
        "get-or-create",
        "workspace",
        "--scope=team",
        "--project=proj",
        ...extra,
      ]),
    );

  test("headless: no prompt and no size when --max-size is omitted", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockShouldPrompt.mockResolvedValue(false);

    await getOrCreate();

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockGetOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ maxSize: undefined }),
    );
  });

  test("interactive: asks for a size when the drive does not exist yet", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockShouldPrompt.mockResolvedValue(true);
    mockList.mockResolvedValue({ drives: [], pagination: { count: 0, next: null } });
    mockPrompt.mockResolvedValue(5 * 1024 ** 3);

    await getOrCreate();

    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ namePrefix: "workspace" }),
    );
    expect(mockPrompt).toHaveBeenCalledWith({ name: "workspace" });
    expect(mockGetOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ maxSize: 5 * 1024 ** 3 }),
    );
  });

  test("interactive: does not ask when the drive already exists", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockShouldPrompt.mockResolvedValue(true);

    await getOrCreate();

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockGetOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ maxSize: undefined }),
    );
  });

  test("interactive: a failed lookup still lets the user answer", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockShouldPrompt.mockResolvedValue(true);
    mockList.mockRejectedValue(new Error("network down"));
    mockPrompt.mockResolvedValue(1024 ** 4);

    await getOrCreate();

    expect(mockPrompt).toHaveBeenCalledOnce();
    expect(mockGetOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ maxSize: 1024 ** 4 }),
    );
  });

  test("--max-size accepts units and never prompts", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockShouldPrompt.mockResolvedValue(true);

    await getOrCreate("--max-size", "5GiB");
    expect(mockGetOrCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxSize: 5368709120 }),
    );

    await getOrCreate("--max-size", "2TiB");
    expect(mockGetOrCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxSize: 2199023255552 }),
    );

    expect(mockPrompt).not.toHaveBeenCalled();
  });

  test("--max-size rejects input it cannot parse", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { drives } = await import("../../src/commands/drives.ts");

    const result = await cmd.runSafely(drives, [
      "get-or-create",
      "workspace",
      "--max-size",
      "2 apples",
      "--scope=team",
      "--project=proj",
    ]);

    expect(result._tag).toBe("error");
    expect(JSON.stringify(result)).toContain("Invalid size");
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });

  test("labels the size after the flag that sets it", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await getOrCreate();

    const output = write.mock.calls.map(([line]) => String(line)).join("");
    expect(output).toContain("max size: ");
  });
});
