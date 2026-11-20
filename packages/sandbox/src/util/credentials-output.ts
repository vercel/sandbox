import { access, constants, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SandboxCredentials } from "@vercel/sandbox";
import { fail } from "./fail";

async function kindOf(path: string): Promise<"file" | "directory" | undefined> {
  try {
    return (await stat(path)).isDirectory() ? "directory" : "file";
  } catch {
    return undefined;
  }
}

/**
 * Checks that --credentials-output can be honored, before the sandbox is
 * created, so that a path that cannot be written never costs a sandbox.
 */
export async function checkCredentialsOutput(
  path: string | undefined,
  credentials: SandboxCredentials | undefined,
): Promise<void> {
  if (path === undefined) {
    return;
  }
  if (credentials === undefined) {
    fail(
      "--credentials-output has no credentials request to write.",
      "Request credentials with --credentials, the --credentials-github-* options, or --credentials-file.",
    );
  }
  if (path === "-") {
    fail(
      "--credentials-output cannot write to stdout, which carries the sandbox name.",
      "Pass the path of a file to create.",
    );
  }
  if ((await kindOf(path)) !== undefined) {
    fail(
      `Cannot write the credentials request to ${path}: the file already exists.`,
      "--credentials-output never overwrites a file. Choose another path, or remove the file first.",
    );
  }
  if ((await kindOf(dirname(path))) !== "directory") {
    fail(
      `Cannot write the credentials request to ${path}: its directory does not exist.`,
      "Create the directory first, or choose another path.",
    );
  }
  try {
    await access(dirname(path), constants.W_OK);
  } catch {
    fail(
      `Cannot write the credentials request to ${path}: its directory is not writable.`,
      "Choose a path in a directory that you can write to.",
    );
  }
}

/**
 * Writes the credentials request of a created sandbox as JSON that
 * --credentials-file reads back unchanged. The write never replaces a file,
 * and a failure names the sandbox, because it already exists by then.
 */
export async function writeCredentialsOutput(
  path: string,
  credentials: SandboxCredentials,
  sandboxName: string,
): Promise<void> {
  try {
    await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    fail(
      `Sandbox ${sandboxName} was created, but its credentials request could not be written to ${path} (${(error as NodeJS.ErrnoException).code}).`,
      "Do not rerun the command to retry the write, because that creates another sandbox.",
    );
  }
}
