import chalk from "chalk";
import { ExitError } from "../error";

/**
 * Throws a usage error with a hint that says how to fix the command. The
 * command exits 1 unless `exitCode` says otherwise.
 */
export function fail(message: string, hint: string, exitCode?: number): never {
  const text = [message, `${chalk.bold("hint:")} ${hint}`].join("\n");
  throw exitCode === undefined
    ? new Error(text)
    : new ExitError(text, exitCode);
}
