import { describe, it, expect } from "vitest";
import { isOutdated } from "./check-latest-version";

describe("isOutdated", () => {
  it("flags older majors, minors and patches", () => {
    expect(isOutdated("3.5.2", "4.0.0")).toBe(true);
    expect(isOutdated("4.0.0", "4.1.0")).toBe(true);
    expect(isOutdated("4.1.0", "4.1.1")).toBe(true);
  });

  it("does not flag equal or newer versions", () => {
    expect(isOutdated("4.0.0", "4.0.0")).toBe(false);
    expect(isOutdated("4.1.0", "4.0.9")).toBe(false);
    expect(isOutdated("5.0.0", "4.9.9")).toBe(false);
  });

  it("opts out for prerelease versions on either side", () => {
    expect(isOutdated("4.1.0-beta.0", "4.1.0")).toBe(false);
    expect(isOutdated("4.0.0", "4.1.0-beta.0")).toBe(false);
  });

  it("opts out when a segment is not numeric", () => {
    expect(isOutdated("4.0.0", "not-a-version")).toBe(false);
  });
});

import { vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Path from "node:path";
import { startLatestVersionCheck } from "./check-latest-version";

describe("startLatestVersionCheck", () => {
  let dir: string;
  let cachePath: string;
  let stderrSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    dir = mkdtempSync(Path.join(tmpdir(), "sandbox-version-"));
    cachePath = Path.join(dir, "latest-version.json");
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  function output(): string {
    return stderrSpy.mock.calls.map((c) => String(c[0])).join("");
  }

  it("serves a fresh cache without touching the registry", () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ latest: "9.9.9", checkedAt: Date.now() }),
    );
    const fetchImpl = vi.fn();
    const check = startLatestVersionCheck({
      cachePath,
      fetchImpl,
      currentVersion: "4.0.0",
    });
    check.report();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(output()).toContain("9.9.9");
  });

  it("refreshes a stale cache and persists the result", async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ latest: "4.0.1", checkedAt: Date.now() - 2 * 60 * 60 * 1000 }),
    );
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 }),
    );
    startLatestVersionCheck({
      cachePath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      currentVersion: "4.0.0",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      const cache = JSON.parse(readFileSync(cachePath, "utf8"));
      expect(cache.latest).toBe("9.9.9");
    });
  });

  it("report() aborts an in-flight registry request", () => {
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {
        // Never resolves: simulates a hung registry.
      });
    });
    const check = startLatestVersionCheck({
      cachePath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      currentVersion: "4.0.0",
    });
    expect(seenSignal?.aborted).toBe(false);
    check.report();
    expect(seenSignal?.aborted).toBe(true);
  });

  it("treats a corrupt cache file as missing", () => {
    writeFileSync(cachePath, "not json{{{");
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 }),
    );
    startLatestVersionCheck({
      cachePath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      currentVersion: "4.0.0",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("tells a standalone install to update the Sandbox CLI", () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ latest: "4.0.0", checkedAt: Date.now() }),
    );
    const check = startLatestVersionCheck({
      cachePath,
      fetchImpl: vi.fn(),
      currentVersion: "3.4.0",
      invokedAs: "sandbox",
    });
    check.report();
    expect(output()).toContain("npm i -g sandbox@latest");
    expect(output()).not.toContain("vercel@latest");
  });

  it("tells a Vercel CLI user to update the Vercel CLI, not to install sandbox", () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ latest: "4.0.0", checkedAt: Date.now() }),
    );
    const check = startLatestVersionCheck({
      cachePath,
      fetchImpl: vi.fn(),
      currentVersion: "3.4.0",
      invokedAs: "vercel sandbox",
    });
    check.report();
    // `npm i -g sandbox@latest` would add a second CLI and leave the bundled
    // copy pinned, so it must not be offered as the fix here.
    expect(output()).not.toContain("Update with npm i -g sandbox@latest");
    expect(output()).toContain("npm i -g vercel@latest");
    expect(output()).toContain("vercel sandbox bundles Sandbox CLI");
    // The bundled copy is capped by the pin, so the notice must describe the
    // mechanism rather than promise that updating reaches latest.
    expect(output()).toContain("This copy tracks the Vercel CLI's pinned version");
    expect(output()).toContain("standalone CLI for the latest");
    // Both versions named, so it is clear which one is behind.
    expect(output()).toContain("3.4.0");
    expect(output()).toContain("4.0.0");
  });

  it("does nothing when SANDBOX_SKIP_VERSION_CHECK is set", () => {
    vi.stubEnv("SANDBOX_SKIP_VERSION_CHECK", "1");
    try {
      const fetchImpl = vi.fn();
      const check = startLatestVersionCheck({
        cachePath,
        fetchImpl,
        currentVersion: "4.0.0",
      });
      check.report();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(output()).toBe("");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

import {
  isVercelCliInvocation,
  setInvokedAs,
  getInvokedAs,
} from "./invocation";

describe("isVercelCliInvocation", () => {
  it("recognises the Vercel CLI invocation", () => {
    expect(isVercelCliInvocation("vercel sandbox")).toBe(true);
  });

  it("does not flag the standalone invocation", () => {
    expect(isVercelCliInvocation("sandbox")).toBe(false);
    expect(isVercelCliInvocation("sbx")).toBe(false);
  });

  it("matches on the first token so a lookalike name does not count", () => {
    expect(isVercelCliInvocation("vercel-sandbox")).toBe(false);
    expect(isVercelCliInvocation("my-vercel sandbox")).toBe(false);
  });

  it("defaults to the recorded invocation", () => {
    const previous = getInvokedAs();
    try {
      setInvokedAs("vercel sandbox");
      expect(isVercelCliInvocation()).toBe(true);
      setInvokedAs("sandbox");
      expect(isVercelCliInvocation()).toBe(false);
    } finally {
      setInvokedAs(previous);
    }
  });
});
