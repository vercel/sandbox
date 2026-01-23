import * as cmd from "cmd-ts";
import chalk from "chalk";

export const sandboxId = cmd.extendType(cmd.string, {
  displayName: "sandbox_id",
  description: "The ID of the sandbox to execute the command in",
  async from(s) {
    if (!s.startsWith("sbx_")) {
      throw new Error(
        [
          `Malformed sandbox ID: "${s}".`,
          `${chalk.bold("hint:")} Sandbox IDs must start with 'sbx_' (e.g., sbx_abc123def456).`,
          "╰▶ run `sandbox list` to see available sandboxes.",
        ].join("\n"),
      );
    }

    return s;
  },
});
