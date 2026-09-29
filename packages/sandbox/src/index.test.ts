import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cmd from "cmd-ts";
import { createApp } from "./index";
import { create } from "./commands/create";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  fork: vi.fn(),
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  sandboxClient: {
    create: mocks.create,
    fork: mocks.fork,
    get: mocks.get,
    list: vi.fn(),
  },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
}));

vi.mock("./telemetry", () => ({
  telemetry: {
    trackInvocation: vi.fn(),
    trackExitCode: vi.fn(),
    flush: vi.fn(),
  },
  readTelemetryConfig: vi.fn(),
  writeTelemetryConfig: vi.fn(),
}));

describe("createApp output", () => {
  const scopeArgs = ["--scope=team", "--project=proj", "--token=test-token"];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SANDBOX_SKIP_VERSION_CHECK", "1");
    const sandbox = {
      name: "my-sandbox",
      region: "iad1",
      interactivePort: 8443,
      routes: [],
    };
    mocks.create.mockResolvedValue(sandbox);
    mocks.fork.mockResolvedValue(sandbox);
    mocks.get.mockResolvedValue({ status: "stopped" });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function stderr(): string {
    return stripVTControlCharacters(
      vi
        .mocked(process.stderr.write)
        .mock.calls.map(([text]) => text)
        .join(""),
    );
  }

  it.each(["create", "fork"])(
    "uses the embedded app name in the %s connection hint",
    async (command) => {
      const app = createApp({ withoutAuth: true, appName: "vercel sandbox" });
      await app.run([
        command,
        ...(command === "fork" ? ["source-sandbox"] : []),
        ...scopeArgs,
      ]);

      expect(stderr()).toContain("connect with: vercel sandbox ssh my-sandbox");
      expect(process.stdout.write).toHaveBeenCalledExactlyOnceWith(
        "my-sandbox",
      );
    },
  );

  it("preserves standalone hints after an embedded run", async () => {
    const app = createApp({ withoutAuth: true, appName: "vercel sandbox" });
    await app.run(["create", ...scopeArgs]);
    vi.mocked(process.stderr.write).mockClear();
    vi.mocked(process.stdout.write).mockClear();

    await cmd.run(create, scopeArgs);

    expect(stderr()).toContain("connect with: sandbox ssh my-sandbox");
    expect(process.stdout.write).toHaveBeenCalledExactlyOnceWith("my-sandbox");
  });
});
