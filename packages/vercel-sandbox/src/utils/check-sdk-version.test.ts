import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import Path from "node:path";
import { isMajorBehind } from "./check-sdk-version.js";

vi.mock("../version.js", () => ({ VERSION: "3.9.1" }));
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: vi.fn(original.homedir) };
});

describe("SDK version policy", () => {
  it.each([
    ["1.1.9", "3.9.1", true],
    ["2.9.9", "3.0.0", true],
    ["3.0.0", "3.9.1", false],
    ["3.9.0", "3.9.1", false],
    ["3.9.1", "3.9.1", false],
    ["4.0.0", "3.9.1", false],
    ["3.9.1-beta.1", "4.0.0", false],
    ["3.9.1", "4.0.0-beta.1", false],
    ["3.9.1+build.1", "4.0.0", true],
    ["3.9", "4.0.0", false],
    ["03.9.1", "4.0.0", false],
    ["3.9.1", "4.0.0\n", false],
    ["3.9.1", "4.0.0\u001b[31m", false],
    ["3.9.1", "9007199254740992.0.0", false],
  ])("compares %s against %s", (current, latest, expected) => {
    expect(isMajorBehind(current, latest)).toBe(expected);
  });
});

describe("SDK version notice", () => {
  let dir: string;
  let cachePath: string;
  let start: typeof import("./check-sdk-version.js").startSdkVersionCheck;
  let warning: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    Reflect.deleteProperty(
      globalThis,
      Symbol.for("@vercel/sandbox/version-check"),
    );
    vi.stubEnv("SANDBOX_SKIP_VERSION_CHECK", "");
    dir = mkdtempSync(Path.join(tmpdir(), "sandbox-sdk-version-"));
    cachePath = Path.join(dir, "latest-version.json");
    warning = vi.spyOn(console, "error").mockImplementation(() => {});
    start = (await import("./check-sdk-version.js")).startSdkVersionCheck;
  });

  afterEach(() => {
    Reflect.deleteProperty(
      globalThis,
      Symbol.for("@vercel/sandbox/version-check"),
    );
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  function cache(latest = "4.0.0", checkedAt = Date.now()) {
    writeFileSync(cachePath, JSON.stringify({ latest, checkedAt }));
  }

  it.each([
    ["linux", ".cache/sandbox-sdk"],
    ["darwin", "Library/Caches/sandbox-sdk"],
    ["win32", "AppData/Local/sandbox-sdk/Cache"],
  ])(
    "reuses the native cache on %s without XDG overrides",
    (platform, relative) => {
      vi.stubGlobal("process", { ...process, platform });
      vi.stubEnv("XDG_CACHE_HOME", "");
      vi.stubEnv("LOCALAPPDATA", "");
      vi.mocked(homedir).mockReturnValue(dir);
      const nativePath = Path.join(dir, relative, "latest-version.json");
      mkdirSync(Path.dirname(nativePath), { recursive: true });
      writeFileSync(
        nativePath,
        JSON.stringify({ latest: "4.0.0", checkedAt: Date.now() }),
      );
      const fetchImpl = vi.fn();
      start({ fetchImpl })?.report();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledOnce();
    },
  );

  it("warns once across clients and report calls, using a fresh cache without network", () => {
    cache();
    const fetchImpl = vi.fn();
    const stdout = vi.spyOn(process.stdout, "write");
    const check = start({ cachePath, fetchImpl });
    expect(start({ cachePath, fetchImpl })).toBeUndefined();
    check?.report();
    check?.report();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
    const text = warning.mock.calls.flat().join("");
    expect(text).toContain("3.9.1");
    expect(text).toContain("4.0.0");
    expect(text).toContain("npm install @vercel/sandbox@latest");
    expect(text).toContain("https://github.com/vercel/sandbox/releases");
    expect(stdout).not.toHaveBeenCalled();
  });

  it("shares the check across independently loaded copies of the SDK", async () => {
    cache();
    const check = start({ cachePath });
    vi.resetModules();
    const other = await import("./check-sdk-version.js");
    expect(other.startSdkVersionCheck({ cachePath })).toBeUndefined();
    check?.report();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("does not warn for a newer minor release", () => {
    cache("3.99.0");
    start({ cachePath })?.report();
    expect(warning).not.toHaveBeenCalled();
  });

  it("refreshes stale metadata with no credentials and warns when the request completes", async () => {
    cache("3.9.1", Date.now() - 3_600_000);
    const fetchImpl = vi.fn(async () => Response.json({ version: "4.0.0" }));
    const check = start({ cachePath, fetchImpl });
    await vi.waitFor(() =>
      expect(JSON.parse(readFileSync(cachePath, "utf8")).latest).toBe("4.0.0"),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@vercel%2Fsandbox/latest",
      { signal: expect.any(AbortSignal) },
    );
    expect(warning).not.toHaveBeenCalled();
    check?.report();
    expect(warning).toHaveBeenCalledOnce();
  });

  it.each([
    "not-json",
    JSON.stringify({ latest: 4, checkedAt: Date.now() }),
    JSON.stringify({ latest: "4.0.0", checkedAt: "now" }),
    JSON.stringify({ latest: "4.0.0", checkedAt: Date.now() + 86_400_000 }),
  ])("ignores an invalid cache: %s", async (contents) => {
    writeFileSync(cachePath, contents);
    const fetchImpl = vi.fn(async () => Response.json({ version: "4.0.0" }));
    const check = start({ cachePath, fetchImpl });
    await vi.waitFor(() => {
      const saved = JSON.parse(readFileSync(cachePath, "utf8"));
      expect(saved.latest).toBe("4.0.0");
      expect(typeof saved.checkedAt).toBe("number");
      expect(saved.checkedAt).toBeLessThanOrEqual(Date.now());
    });
    check?.report();
    expect(warning).toHaveBeenCalledOnce();
  });

  it.each([
    () => {
      throw new Error("offline");
    },
    () => Promise.reject(new Error("offline")),
    async () => new Response("unavailable", { status: 503 }),
    async () => new Response("invalid JSON"),
    async () => Response.json({ version: "4.0.0\u001b[31m" }),
    async () => Response.json(null),
  ])("ignores registry failures and malformed responses", async (fetchImpl) => {
    const check = start({
      cachePath,
      fetchImpl: vi.fn(fetchImpl) as typeof fetch,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(() => check?.report()).not.toThrow();
    expect(warning).not.toHaveBeenCalled();
  });

  it("uses stale metadata if the registry is unavailable", async () => {
    cache("4.0.0", Date.now() - 3_600_000);
    const check = start({
      cachePath,
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
    });
    await Promise.resolve();
    check?.report();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("cancels a slow lookup as soon as the API request finishes", async () => {
    let signal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((_input: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const check = start({ cachePath, fetchImpl });
    await Promise.resolve();
    expect(signal?.aborted).toBe(false);
    check?.report();
    expect(signal?.aborted).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  });

  it("times out the lookup after one second even while the API request is running", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const check = start({
      cachePath,
      fetchImpl: vi.fn((_input: unknown, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>(() => {});
      }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(true);
    check?.report();
  });

  it("can warn when the cache cannot be written", async () => {
    writeFileSync(cachePath, "a file, not a directory");
    const fetchImpl = vi.fn(async () => Response.json({ version: "4.0.0" }));
    const check = start({
      cachePath: Path.join(cachePath, "child"),
      fetchImpl,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    check?.report();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("skips all work when disabled, even with a cached warning", () => {
    cache();
    vi.stubEnv("SANDBOX_SKIP_VERSION_CHECK", "1");
    const fetchImpl = vi.fn();
    expect(start({ cachePath, fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it("skips prerelease installations", () => {
    const fetchImpl = vi.fn();
    expect(
      start({ cachePath, fetchImpl, currentVersion: "4.0.0-beta.1" }),
    ).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
