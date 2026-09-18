import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mockDetectAgentName } = vi.hoisted(() => ({
  mockDetectAgentName: vi.fn(),
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
