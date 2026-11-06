import { afterEach, expect, test, vi } from "vitest";
import { detectAgentName } from "../../src/telemetry/agent";
import { isInteractive } from "../../src/util/execution-mode";

vi.mock("../../src/telemetry/agent", () => ({
  detectAgentName: vi.fn(),
}));

const streams = [process.stdin, process.stderr];
const ttyDescriptors = streams.map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY"),
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  streams.forEach((stream, index) => {
    const descriptor = ttyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
    else Reflect.deleteProperty(stream, "isTTY");
  });
});

test.each([
  // name, CI, stdin TTY, stderr TTY, config stdin, agent, interactive
  ["terminal", undefined, true, true, false, undefined, true],
  ["empty CI", "", true, true, false, undefined, true],
  ["CI", "1", true, true, false, undefined, false],
  ["nonempty CI", "false", true, true, false, undefined, false],
  ["piped stdin", undefined, false, true, false, undefined, false],
  ["redirected stderr", undefined, true, false, false, undefined, false],
  ["config stdin", undefined, true, true, true, undefined, false],
  ["detected agent", undefined, true, true, false, "codex", false],
] as const)(
  "%s",
  async (_name, ci, stdinTTY, stderrTTY, payloadStdin, agent, expected) => {
    vi.stubEnv("CI", ci);
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: stdinTTY,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: stderrTTY,
    });
    vi.mocked(detectAgentName).mockResolvedValue(agent);
    expect(await isInteractive({ payloadStdin })).toBe(expected);
  },
);
