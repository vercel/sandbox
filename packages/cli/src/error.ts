import chalk from "chalk";

export class StyledError extends Error {
  name = "StyledError";
  constructor(message: string, cause?: unknown) {
    super(chalk.red(message), { cause });
  }
}
