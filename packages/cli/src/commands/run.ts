import * as cmd from "cmd-ts";
import * as Create from "./create";
import * as Exec from "./exec";
import { omit } from "../util/omit";
import ora from "ora";

const args = {
  ...omit(Create.args, "silent"),
  ...omit(Exec.args, "sandbox"),
  removeAfterUse: cmd.flag({
    long: "rm",
    description: "Automatically remove the sandbox when the command exits.",
  }),
} as const;

export const run = cmd.command({
  name: "run",
  description: "Create and run a command in a sandbox",
  args,
  async handler({ removeAfterUse, ...rest }) {
    const spinner = ora("Creating sandbox...").start();
    const sandbox = await Create.create.handler({ ...rest, silent: true });
    spinner.stop();
    try {
      await Exec.exec.handler({ ...rest, sandbox });
    } finally {
      if (removeAfterUse) {
        await sandbox.stop();
      }
    }
  },
});

export const sh = cmd.command({
  name: "sh",
  description: "Create a sandbox and run an interactive shell.",
  aliases: ["shell"],
  args: omit(args, "command", "interactive", "tty"),
  async handler(args) {
    return run.handler({
      command: "sh",
      interactive: true,
      tty: true,
      ...args,
    });
  },
});
