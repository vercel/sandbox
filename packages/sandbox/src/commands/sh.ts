import * as cmd from "cmd-ts";
import * as Create from "./create";
import { omit } from "../util/omit";

export const sh = cmd.command({
  name: "sh",
  description: "Create a sandbox and start an interactive shell",
  args: omit(Create.args, "connect"),
  async handler(args) {
    return Create.create.handler({
      ...args,
      connect: true,
    });
  },
});
