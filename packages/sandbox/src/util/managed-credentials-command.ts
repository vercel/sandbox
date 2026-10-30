import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const GIT_TIMEOUT_MS = 5_000;

export type CommandResult =
  | { status: "ok"; stdout: string }
  | { status: "absent" }
  | { status: "failed"; stderr: string };

/** Read metadata only. Identity callers must distinguish failure from absence. */
export async function runCommand(
  file: string,
  args: string[],
  timeout: number,
  cwd?: string,
): Promise<CommandResult> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout,
      ...(cwd ? { cwd } : {}),
    });
    return { status: "ok", stdout: stdout.trim() };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
      return { status: "absent" };
    const stderr = (error as { stderr?: unknown })?.stderr;
    return {
      status: "failed",
      stderr: typeof stderr === "string" ? stderr : "",
    };
  }
}

/** For local context, failure means a missing value, never a substitute identity. */
export async function readCommand(
  file: string,
  args: string[],
  timeout: number,
  cwd?: string,
): Promise<string | undefined> {
  const result = await runCommand(file, args, timeout, cwd);
  return result.status === "ok" && result.stdout.length > 0
    ? result.stdout
    : undefined;
}
