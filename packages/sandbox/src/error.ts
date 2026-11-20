import chalk from "chalk";

export class StyledError extends Error {
  name = "StyledError";
  constructor(message: string, cause?: unknown) {
    super(chalk.red(message), { cause });
  }
}

/**
 * Ends the command with an exit code other than 1, such as 130 for a
 * cancellation or 2 for input the command still needs.
 */
export class ExitError extends Error {
  name = "ExitError";
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

/**
 * The exit code a command ends with after it threw this error.
 */
export function exitCodeOf(error: unknown): number {
  return error instanceof ExitError ? error.exitCode : 1;
}
