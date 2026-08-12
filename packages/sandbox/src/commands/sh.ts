import * as cmd from "cmd-ts";
import chalk from "chalk";
import * as Create from "./create";
import { omit } from "../util/omit";

export const sh = cmd.command({
  name: "sh",
  description: "Create a sandbox and start an interactive shell",
  args: {
    ...omit(Create.args, "connect"),
    // `sh` takes no command, but `sandbox sh claude` is a natural thing to
    // type — catch it and point at the command that does what they meant.
    command: cmd.restPositionals({
      displayName: "command",
      type: cmd.string,
    }),
  },
  async handler({ command, ...args }) {
    if (command.length > 0) {
      throw new Error(
        [
          `\`sh\` starts a plain shell and doesn't take a command.`,
          `${chalk.bold("hint:")} to run ${chalk.cyan(command.join(" "))} interactively in a new sandbox:`,
          `╰▶ sandbox run --rm -i ${command.join(" ")}`,
        ].join("\n"),
      );
    }

    return Create.create.handler({
      ...args,
      connect: true,
    });
  },
});
