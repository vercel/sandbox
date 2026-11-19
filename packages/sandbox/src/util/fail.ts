import chalk from "chalk";

/**
 * Throws a usage error with a hint that says how to fix the command.
 */
export function fail(message: string, hint: string): never {
  throw new Error([message, `${chalk.bold("hint:")} ${hint}`].join("\n"));
}
