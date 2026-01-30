import * as cmd from "cmd-ts";
import * as Exec from "./exec";
import { omit } from "../util/omit";

export const connect = cmd.command({
  name: "connect",
  aliases: ["ssh", "shell"],
  description: "Start an interactive shell in an existing sandbox",
  args: omit(Exec.args, "command", "args", "interactive", "tty"),
  async handler(args) {
    return Exec.exec.handler({
      command: "sh",
      args: [],
      interactive: true,
      tty: true,
      ...args,
    });
  },
});
