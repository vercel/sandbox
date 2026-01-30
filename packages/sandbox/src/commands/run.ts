import * as cmd from "cmd-ts";
import * as Create from "./create";
import * as Exec from "./exec";
import { omit } from "../util/omit";

const args = {
  ...Create.args,
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
    const sandbox = await Create.create.handler({ ...rest });
    try {
      await Exec.exec.handler({ ...rest, sandbox });
    } finally {
      if (removeAfterUse) {
        await sandbox.stop();
      }
    }
  },
});
