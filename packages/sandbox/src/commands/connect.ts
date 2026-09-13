import * as cmd from "cmd-ts";
import * as Exec from "./exec";
import { omit } from "../util/omit";

export const connect = cmd.command({
  name: "connect",
  aliases: ["ssh", "shell"],
  description: "Start an interactive shell in an existing sandbox",
  args: omit(Exec.args, "command", "args", "interactive", "tty"),
  async handler(args) {
    return Exec.execute({
      // No command: the sandbox opens the account's configured shell.
      command: undefined,
      args: [],
      interactive: true,
      ...args,
    });
  },
});
