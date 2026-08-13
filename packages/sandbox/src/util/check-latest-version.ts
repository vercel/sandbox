import chalk from "chalk";
import { version } from "../pkg";

const REGISTRY_URL = "https://registry.npmjs.org/sandbox/latest";

export interface VersionCheck {
  /**
   * Print a stderr notice when a newer release is already known.
   * Synchronous and non-blocking: if the registry hasn't answered yet,
   * nothing is printed.
   */
  report(): void;
}

/**
 * Start a latest-version lookup concurrently with the command's own network
 * work, so the check adds no latency of its own. Stale clients silently keep
 * old creation defaults (e.g. the base image), so surfacing "you're behind"
 * at creation time is the only signal that reaches globally-installed CLIs.
 *
 * Set SANDBOX_SKIP_VERSION_CHECK=1 to disable (e.g. in CI).
 */
export function startLatestVersionCheck(): VersionCheck {
  let latest: string | undefined;

  if (!process.env.SANDBOX_SKIP_VERSION_CHECK) {
    fetch(REGISTRY_URL, { signal: AbortSignal.timeout(1500) })
      .then((res) => (res.ok ? res.json() : undefined))
      .then((json) => {
        latest = (json as { version?: string } | undefined)?.version;
      })
      .catch(() => {
        // Never let the version check interfere with the actual command.
      });
  }

  return {
    report() {
      if (latest && isOutdated(version, latest)) {
        process.stderr.write(
          chalk.yellow("⚠ ") +
            `A newer Sandbox CLI is available: ${chalk.cyan(latest)}` +
            chalk.dim(` (you're on ${version})`) +
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
