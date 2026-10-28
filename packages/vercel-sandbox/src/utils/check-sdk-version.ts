import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Path from "node:path";
import xdgAppPaths from "xdg-app-paths";
import { VERSION } from "../version.js";
import * as Log from "./log.js";

const REGISTRY_URL = "https://registry.npmjs.org/@vercel%2Fsandbox/latest";
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1000;
const CHECKED = Symbol.for("@vercel/sandbox/version-check");
const state = globalThis as typeof globalThis & { [CHECKED]?: boolean };

interface VersionCache {
  latest: string;
  checkedAt: number;
}

interface VersionCheckOptions {
  cachePath?: string;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
}

function stableMajor(version: unknown): number | undefined {
  if (typeof version !== "string") return;
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    );
  if (
    !match ||
    !match.slice(1).every((part) => Number.isSafeInteger(Number(part)))
  )
    return;
  return Number(match[1]);
}

export function isMajorBehind(current: string, latest: string): boolean {
  const currentMajor = stableMajor(current);
  const latestMajor = stableMajor(latest);
  return (
    currentMajor !== undefined &&
    latestMajor !== undefined &&
    currentMajor < latestMajor
  );
}

function readCache(path: string): VersionCache | undefined {
  try {
    const cache = JSON.parse(readFileSync(path, "utf8")) as VersionCache;
    if (
      stableMajor(cache.latest) !== undefined &&
      Number.isFinite(cache.checkedAt) &&
      cache.checkedAt >= 0 &&
      cache.checkedAt <= Date.now()
    )
      return cache;
  } catch {}
}

/** Internal options allow tests to isolate the registry and cache. */
export function startSdkVersionCheck(
  opts: VersionCheckOptions = {},
): { report(): void } | undefined {
  if (state[CHECKED] || process.env.SANDBOX_SKIP_VERSION_CHECK) return;
  const current = opts.currentVersion ?? VERSION;
  if (stableMajor(current) === undefined) return;
  state[CHECKED] = true;

  try {
    const cachePath =
      opts.cachePath ??
      Path.join(xdgAppPaths("sandbox-sdk").cache(), "latest-version.json");
    const cached = readCache(cachePath);
    let latest = cached?.latest;
    let controller: AbortController | undefined;
    let reported = false;

    if (!cached || Date.now() - cached.checkedAt >= CACHE_TTL_MS) {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
      timeout.unref?.();
      // Never forward Sandbox credentials or the caller's custom transport to npm.
      Promise.resolve()
        .then(() =>
          (opts.fetchImpl ?? fetch)(REGISTRY_URL, {
            signal: controller!.signal,
          }),
        )
        .then((res) => (res.ok ? res.json() : undefined))
        .then((json: unknown) => {
          const version = (json as { version?: unknown } | undefined)?.version;
          if (typeof version !== "string" || stableMajor(version) === undefined)
            return;
          latest = version;
          try {
            mkdirSync(Path.dirname(cachePath), { recursive: true });
            writeFileSync(
              cachePath,
              JSON.stringify({ latest, checkedAt: Date.now() }),
            );
          } catch {}
        })
        .catch(() => {})
        .finally(() => clearTimeout(timeout));
    }

    return {
      report() {
        if (reported) return;
        reported = true;
        // An advisory lookup must not outlive the API request that started it.
        controller?.abort();
        if (
          process.env.SANDBOX_SKIP_VERSION_CHECK ||
          !latest ||
          !isMajorBehind(current, latest)
        )
          return;
        try {
          Log.write("warn", [
            `Sandbox SDK ${current} is behind the latest major release (${latest}).`,
            "Review the release notes before upgrading: https://github.com/vercel/sandbox/releases",
            "Update with: npm install @vercel/sandbox@latest",
            "Set SANDBOX_SKIP_VERSION_CHECK=1 to disable version checks.",
          ]);
        } catch {}
      },
    };
  } catch {
    // Read-only filesystems and unavailable home directories must not break SDK calls.
    return;
  }
}
