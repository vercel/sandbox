import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mockDetectAgentName, mockQuestion, mockClose } = vi.hoisted(() => ({
  mockDetectAgentName: vi.fn(),
  mockQuestion: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question: mockQuestion, close: mockClose }),
}));

vi.mock("../../src/telemetry/agent", () => ({
  detectAgentName: mockDetectAgentName,
}));

function setTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean | undefined) {
  Object.defineProperty(stream, "isTTY", { value, configurable: true });
}

describe("shouldPromptForDriveSize", () => {
  const originalCI = process.env.CI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectAgentName.mockResolvedValue(undefined);
    setTTY(process.stdin, true);
    setTTY(process.stderr, true);
    delete process.env.CI;
  });

  afterEach(() => {
    setTTY(process.stdin, undefined);
    setTTY(process.stderr, undefined);
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
  });

  test("prompts only for a person at a terminal", async () => {
    const { shouldPromptForDriveSize } = await import("../../src/util/prompt.ts");
    await expect(shouldPromptForDriveSize()).resolves.toBe(true);
  });

  test("never prompts when stdin is not a terminal", async () => {
    setTTY(process.stdin, undefined);
    const { shouldPromptForDriveSize } = await import("../../src/util/prompt.ts");
    await expect(shouldPromptForDriveSize()).resolves.toBe(false);
  });

  test("never prompts when stderr is not a terminal", async () => {
    setTTY(process.stderr, undefined);
    const { shouldPromptForDriveSize } = await import("../../src/util/prompt.ts");
    await expect(shouldPromptForDriveSize()).resolves.toBe(false);
  });

  test("never prompts in CI", async () => {
    process.env.CI = "true";
    const { shouldPromptForDriveSize } = await import("../../src/util/prompt.ts");
    await expect(shouldPromptForDriveSize()).resolves.toBe(false);
  });

  test("never prompts when an AI agent is driving the CLI", async () => {
    mockDetectAgentName.mockResolvedValue("claude-code");
    const { shouldPromptForDriveSize } = await import("../../src/util/prompt.ts");
    await expect(shouldPromptForDriveSize()).resolves.toBe(false);
  });
});

describe("promptDriveSize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("Enter keeps the API default", async () => {
    mockQuestion.mockResolvedValueOnce("");
    const { promptDriveSize } = await import("../../src/util/prompt.ts");
    await expect(promptDriveSize({ name: "workspace" })).resolves.toBeUndefined();
    expect(mockQuestion).toHaveBeenCalledOnce();
    expect(mockQuestion.mock.calls[0][0]).toContain(
      "Size limit for workspace (fixed after creation)",
    );
    expect(mockClose).toHaveBeenCalledOnce();
  });

  test("parses a size with a unit", async () => {
    mockQuestion.mockResolvedValueOnce(" 5GiB ");
    const { promptDriveSize } = await import("../../src/util/prompt.ts");
    await expect(promptDriveSize({ name: "workspace" })).resolves.toBe(5 * 1024 ** 3);
    expect(mockClose).toHaveBeenCalledOnce();
  });

  test("re-asks after an invalid answer and closes once", async () => {
    mockQuestion.mockResolvedValueOnce("5 apples").mockResolvedValueOnce("2TiB");
    const { promptDriveSize } = await import("../../src/util/prompt.ts");
    await expect(promptDriveSize({ name: "workspace" })).resolves.toBe(2 * 1024 ** 4);
    expect(mockQuestion).toHaveBeenCalledTimes(2);
    const errors = (process.stderr.write as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes("Invalid size"));
    expect(errors).toHaveLength(1);
    expect(mockClose).toHaveBeenCalledOnce();
  });

  test("closes the interface even when the prompt throws", async () => {
    mockQuestion.mockRejectedValueOnce(new Error("Aborted with Ctrl+C"));
    const { promptDriveSize } = await import("../../src/util/prompt.ts");
    await expect(promptDriveSize({ name: "workspace" })).rejects.toThrow("Ctrl+C");
    expect(mockClose).toHaveBeenCalledOnce();
  });
});
