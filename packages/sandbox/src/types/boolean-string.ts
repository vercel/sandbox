import { extendType, string } from "cmd-ts";
import chalk from "chalk";

export const BooleanString = extendType(string, {
  displayName: "true|false",
  description: "A boolean value: true or false",
  async from(value): Promise<boolean> {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }

    throw new Error(
      [
        `Invalid boolean: "${value}".`,
        `${chalk.bold("hint:")} Use "true" or "false".`,
      ].join("\n"),
    );
  },
});
