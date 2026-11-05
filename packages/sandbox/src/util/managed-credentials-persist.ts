import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { CliError } from "./cli-error";
import {
  type ManagedCredentialsConfig,
  serializeConfig,
} from "./managed-credentials-config";

/**
 * Resolve where `--credentials-github-persist-configuration` should write.
 *
 * The flag always carries an explicit path. A relative one is resolved against
 * the working directory.
 */
export function resolvePersistPath(options: {
  requested: string;
  cwd?: string;
}): string {
  const cwd = options.cwd ?? process.cwd();
  // A path ending in a separator names a directory, which would make the
  // write fail with a confusing EISDIR rather than a clear message.
  if (/[\\/]$/.test(options.requested)) {
    throw new CliError(
      "--credentials-github-persist-configuration expects a file path, not a directory.",
      { reason: "persist_failed" },
    );
  }

  return isAbsolute(options.requested)
    ? options.requested
    : resolve(cwd, options.requested);
}

export interface PersistResult {
  path: string;
}

/**
 * Write the configuration so it round-trips through
 * `--credentials-github-from-config-file`.
 *
 * Uses an exclusive create so an existing file is never silently overwritten;
 * the user is told the path and asked to move it or choose another. Failures
 * here are local-only: the Sandbox already exists, and the caller reports its
 * identity rather than creating another one to retry the write.
 */
export async function persistConfiguration(options: {
  config: ManagedCredentialsConfig;
  path: string;
}): Promise<PersistResult> {
  try {
    await writeFile(options.path, serializeConfig(options.config), {
      encoding: "utf8",
      // "wx" fails when the path exists, which is what keeps an unrelated
      // user file safe.
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EEXIST") {
      throw new CliError(
        `Can't write the configuration: ${options.path} already exists. Move it or pass a different --credentials-github-persist-configuration path.`,
        { reason: "persist_failed", data: { path: options.path } },
      );
    }
    throw new CliError(
      `Can't write the configuration to ${options.path}${code ? ` (${code})` : ""}.`,
      { reason: "persist_failed", data: { path: options.path } },
    );
  }
  return { path: options.path };
}
