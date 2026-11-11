import { testConfig } from "../../test/config.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { determineAgent } from "@vercel/detect-agent";
import { detectAgentName } from "./detect-agent.js";

vi.mock("@vercel/detect-agent", () => ({
  determineAgent: vi.fn(async () => ({
    isAgent: true,
    agent: { name: "codex" },
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("agent attribution", () => {
  it.each([
    "VERCEL_TELEMETRY_DISABLED",
    "VERCEL_SANDBOX_TELEMETRY_DISABLED",
    "VERCEL_DRIVES_TELEMETRY_DISABLED",
  ])("honors %s after detection has been cached", async (variable) => {
    vi.stubEnv("VERCEL_TELEMETRY_DISABLED", "");
    vi.stubEnv("VERCEL_SANDBOX_TELEMETRY_DISABLED", "");
    vi.stubEnv("VERCEL_DRIVES_TELEMETRY_DISABLED", "");
    await expect(
      detectAgentName(testConfig.telemetryDisabledEnv),
    ).resolves.toBe("codex");
    vi.mocked(determineAgent).mockClear();

    vi.stubEnv(variable, "1");

    await expect(
      detectAgentName(testConfig.telemetryDisabledEnv),
    ).resolves.toBeUndefined();
    expect(determineAgent).not.toHaveBeenCalled();
  });
});
