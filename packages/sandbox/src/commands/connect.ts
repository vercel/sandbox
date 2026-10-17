import { commandMetadata } from "../command-metadata";
import * as cmd from "cmd-ts";
import { exec, args as execArgs } from "./exec";
import { omit } from "../util/omit";
import { defaultShell } from "../interactive-shell/default-shell";

export const connect = cmd.command({
  ...commandMetadata.connect,
  args: omit(execArgs, "command", "args", "interactive", "tty"),
  async handler(args) {
    return exec.handler({
      ...defaultShell,
      interactive: true,
      tty: true,
      ...args,
    });
  },
});
