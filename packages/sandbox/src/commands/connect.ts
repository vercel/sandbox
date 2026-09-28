import * as cmd from "cmd-ts";
import * as Exec from "./exec";
import { omit } from "../util/omit";
import { defaultShell } from "../interactive-shell/default-shell";

export const connect = cmd.command({
  name: "connect",
  aliases: ["ssh", "shell"],
  description: "Start an interactive shell in an existing sandbox",
  args: omit(Exec.args, "command", "args", "interactive", "tty"),
  async handler(args) {
    return Exec.exec.handler({
      ...defaultShell,
      interactive: true,
      tty: true,
      ...args,
    });
  },
});
