import * as cmd from "cmd-ts";
import chalk from "chalk";

export const sandboxName = cmd.extendType(cmd.string, {
  displayName: "name",
  description: "The name of the sandbox",
  async from(s) {
    if (!s || s.trim().length === 0) {
      throw new Error(
        [
          `Sandbox name cannot be empty.`,
          `${chalk.bold("hint:")} Provide a sandbox name.`,
          "╰▶ run `sandbox list` to see available sandboxes.",
        ].join("\n"),
      );
    }

    return s;
  },
});
