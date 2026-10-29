import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { confirmCreation } from "../../src/util/confirm-creation";
import { resolveExecutionMode } from "../../src/util/execution-mode";
import type { CreateContext } from "../../src/args/create-context";

const { agent, readline } = vi.hoisted(() => ({
  agent: vi.fn(),
  readline: vi.fn(),
}));
vi.mock("../../src/telemetry/agent", () => ({ detectAgentName: agent }));
vi.mock("node:readline", () => ({ createInterface: readline }));

const context: CreateContext = {
  token: "test-token",
  team: "acme",
  project: "acme-web",
  yes: false,
  creationRequested: true,
  mode: { json: false, interactive: true },
  creation: { credentials: { github: [] } },
};
const descriptors = [process.stdin, process.stderr, process.stdout].map(
  (stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"),
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CI", "");
  agent.mockResolvedValue(undefined);
  for (const stream of [process.stdin, process.stderr, process.stdout])
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  [process.stdin, process.stderr, process.stdout].forEach((stream, i) => {
    if (descriptors[i]) Object.defineProperty(stream, "isTTY", descriptors[i]!);
    else delete (stream as { isTTY?: boolean }).isTTY;
  });
});

describe("execution modes", () => {
  const base = { json: false, payloadStdin: false };
  test("piping stdout does not suppress interactive confirmation", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    await expect(resolveExecutionMode(base)).resolves.toEqual({
      json: false,
      interactive: true,
    });
  });
  test.each([{ json: true }, { payloadStdin: true }, { nonInteractive: true }])(
    "explicit mode disables prompts: %j",
    async (options) => {
      await expect(
        resolveExecutionMode({ ...base, ...options }),
      ).resolves.toMatchObject({ interactive: false });
    },
  );
  test("CI cannot restore prompts", async () => {
    vi.stubEnv("CI", "1");
    await expect(
      resolveExecutionMode({ ...base, nonInteractive: false }),
    ).resolves.toMatchObject({ interactive: false });
  });
  test("agents default to non-interactive but may opt in on a terminal", async () => {
    agent.mockResolvedValue("test-agent");
    await expect(resolveExecutionMode(base)).resolves.toMatchObject({
      interactive: false,
    });
    await expect(
      resolveExecutionMode({ ...base, nonInteractive: false }),
    ).resolves.toMatchObject({ interactive: true });
  });
  test("missing stdin or stderr TTY always disables prompts", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    await expect(
      resolveExecutionMode({ ...base, nonInteractive: false }),
    ).resolves.toMatchObject({ interactive: false });
  });
});

describe("managed access consent", () => {
  function answer(value?: string) {
    const rl = new EventEmitter() as EventEmitter & {
      close(): void;
      question(prompt: string, cb: (value: string) => void): void;
    };
    rl.close = () => {
      rl.emit("close");
    };
    rl.question = vi.fn((_prompt, cb) => {
      if (value === undefined) rl.emit("SIGINT");
      else cb(value);
    });
    readline.mockReturnValue(rl);
    return rl;
  }
  test("yes bypasses only confirmation and never prompts", async () => {
    await confirmCreation({ ...context, yes: true });
    expect(readline).not.toHaveBeenCalled();
  });
  test("ordinary source-only creation requires no confirmation", async () => {
    await confirmCreation({
      ...context,
      creation: {
        source: { type: "git", url: "https://github.com/acme/widgets.git" },
      },
    });
    expect(readline).not.toHaveBeenCalled();
  });
  test("an explicit affirmative answer allows creation", async () => {
    const rl = answer("yes");
    await expect(confirmCreation(context)).resolves.toBeUndefined();
    expect(rl.question).toHaveBeenCalledWith(
      expect.stringContaining("(y/N)"),
      expect.any(Function),
    );
  });
  test.each(["", "no", "anything else"])(
    "declining with %j cancels",
    async (value) => {
      answer(value);
      await expect(confirmCreation(context)).rejects.toMatchObject({
        exitCode: 130,
      });
    },
  );
  test("Ctrl+C cancels without work", async () => {
    answer();
    await expect(confirmCreation(context)).rejects.toMatchObject({
      exitCode: 130,
    });
  });
  test("non-interactive missing consent never prompts", async () => {
    await expect(
      confirmCreation({ ...context, mode: { json: true, interactive: false } }),
    ).rejects.toMatchObject({
      options: {
        json: true,
        reason: "confirmation_required",
        userActionRequired: true,
      },
    });
    expect(readline).not.toHaveBeenCalled();
  });
});
