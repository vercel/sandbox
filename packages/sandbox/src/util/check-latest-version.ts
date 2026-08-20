import chalk from "chalk";
import xdgAppPaths from "xdg-app-paths";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Path from "node:path";
import { version } from "../pkg";

const REGISTRY_URL = "https://registry.npmjs.org/sandbox/latest";

/**
 * Re-check the registry at most once per hour; the cache file answers in
 * between, so most commands never touch the network. Mirrors the Vercel
 * CLI's caching approach (XDG cache file + refresh interval), without the
 * detached worker process it uses.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Budget for a registry round trip when one does run. `report()` aborts an
 * in-flight request anyway, so this only bounds how long a slow registry has
 * to answer before the notice is skipped for this run.
 */
const FETCH_TIMEOUT_MS = 1000;

interface VersionCache {
  latest: string;
  checkedAt: number;
}

export interface VersionCheck {
  /**
   * Print a stderr notice when a newer release is known (from the cache or
   * from a lookup that finished in time), and abort any still-in-flight
   * registry request so it can never keep the process alive after the
   * command is done.
   */
  report(): void;
}

/** Options exist for tests; production callers pass nothing. */
export interface VersionCheckOptions {
  cachePath?: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  currentVersion?: string;
}

function defaultCachePath(): string {
  return Path.join(xdgAppPaths("sandbox-cli").cache(), "latest-version.json");
}

function readCache(cachePath: string): VersionCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as VersionCache;
    if (
      typeof parsed.latest === "string" &&
      typeof parsed.checkedAt === "number"
    ) {
      return parsed;
    }
  } catch {
    // A missing or corrupt cache is the same as no cache.
  }
  return undefined;
}

function writeCache(cachePath: string, cache: VersionCache): void {
  try {
    mkdirSync(Path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache));
  } catch {
    // The cache is best-effort; the next run simply checks again.
  }
}

/**
 * Start a latest-version check. With a fresh cache this is synchronous and
 * network-free; with a stale or missing cache it fires one registry lookup
 * concurrently with the command's own network work, so it adds no latency.
 * Stale clients silently keep old creation defaults (e.g. the base image),
 * so surfacing "you're behind" at creation time is the only signal that
 * reaches globally-installed CLIs.
 *
 * Set SANDBOX_SKIP_VERSION_CHECK=1 to disable (e.g. in CI).
 */
export function startLatestVersionCheck(
  opts: VersionCheckOptions = {},
): VersionCheck {
  if (process.env.SANDBOX_SKIP_VERSION_CHECK) {
    return { report() {} };
  }

  const cachePath = opts.cachePath ?? defaultCachePath();
  const ttlMs = opts.ttlMs ?? CACHE_TTL_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const current = opts.currentVersion ?? version;

  const cached = readCache(cachePath);
  let latest = cached?.latest;
  let controller: AbortController | undefined;

  const fresh = cached !== undefined && Date.now() - cached.checkedAt < ttlMs;
  if (!fresh) {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
    timeout.unref?.();
    fetchImpl(REGISTRY_URL, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : undefined))
      .then((json) => {
        const fetched = (json as { version?: string } | undefined)?.version;
        if (fetched) {
          latest = fetched;
          writeCache(cachePath, { latest: fetched, checkedAt: Date.now() });
        }
      })
      .catch(() => {
        // Never let the version check interfere with the actual command.
      })
      .finally(() => clearTimeout(timeout));
  }

  return {
    report() {
      // Tear down an in-flight request first: a pending registry call must
      // not keep the event loop alive after the command has finished.
      controller?.abort();
      if (latest && isOutdated(current, latest)) {
        process.stderr.write(
          chalk.yellow("⚠ ") +
            `A newer Sandbox CLI is available: ${chalk.cyan(latest)}` +
            chalk.dim(` (you're on ${current})`) +
            "\n" +
            chalk.dim("   ╰ ") +
            "newer versions can change creation defaults like the base image. Update with " +
            chalk.cyan("npm i -g sandbox@latest") +
            "\n",
        );
      }
    },
  };
}

/**
 * Minimal x.y.z comparison. Prerelease versions on either side opt out of
 * the notice entirely rather than risking a wrong comparison.
 */
export function isOutdated(current: string, latest: string): boolean {
  if (current.includes("-") || latest.includes("-")) {
    return false;
  }
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const a = c[i] ?? 0;
    const b = l[i] ?? 0;
    if (Number.isNaN(a) || Number.isNaN(b)) {
      return false;
    }
    if (b !== a) {
      return b > a;
    }
  }
  return false;
}
