import * as readline from "node:readline/promises";
import chalk from "chalk";
import { parseDriveSize } from "../args/drive";
import { detectAgentName } from "../telemetry/agent";

/**
 * A prompt is only safe when a person can answer it. Agents, pipes, cron
 * and CI must keep creating drives unattended, so every one of these gates
 * has to pass: both stdin and stderr are terminals, CI is not set, and the
 * agent detector (already used for telemetry) sees no agent.
 */
export async function shouldPromptForDriveSize(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return false;
  }
  if (process.env.CI) {
    return false;
  }
  return (await detectAgentName()) === undefined;
}

/**
 * Asks for the size limit of a drive that is about to be created. Resolves
 * to `undefined` on an empty answer so the API applies its plan default.
 * Writes to stderr, like the rest of the drive output, so stdout stays clean.
 */
export async function promptDriveSize({
  name,
}: {
  name: string;
}): Promise<number | undefined> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    for (;;) {
      const answer = await rl.question(
        `${chalk.cyan("?")} Size limit for ${chalk.cyan(name)} (fixed after creation) ${chalk.dim("›")} ` +
          "defaults to 1 TiB, accepts GiB or TiB, configurable up to 16 TiB on this team. " +
          `Enter to continue with the default.\n${chalk.dim("›")} `,
      );
      const value = answer.trim();
      if (value === "") {
        return undefined;
      }
      try {
        return parseDriveSize(value);
      } catch (error) {
        process.stderr.write(chalk.red(`${(error as Error).message}\n`));
      }
    }
  } finally {
    rl.close();
  }
}
