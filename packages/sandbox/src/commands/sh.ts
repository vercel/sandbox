import * as cmd from "cmd-ts";
import * as Create from "./create";
import * as Exec from "./exec";
import { omit } from "../util/omit";

const args = {
  ...omit(Create.args, "connect"),
  removeAfterUse: cmd.flag({
    long: "rm",
    description: "Automatically remove the sandbox when the shell exits.",
  }),
} as const;

export const sh = cmd.command({
  name: "sh",
  description: "Create a sandbox and start an interactive shell",
  args,
  async handler({ removeAfterUse, ...rest }) {
    if (!removeAfterUse) {
      return Create.create.handler({
        ...rest,
        connect: true,
      });
    }

    const sandbox = await Create.create.handler({
      ...rest,
      connect: false,
      nonPersistent: true,
      __printConnectHint: false,
    } as Parameters<typeof Create.create.handler>[0]);

    try {
      await Exec.exec.handler({
        scope: rest.scope,
        asSudo: false,
        args: [],
        cwd: undefined,
        skipExtendingTimeout: false,
        envVars: {},
        command: "sh",
        interactive: true,
        tty: true,
        sandbox,
        timeout: undefined,
      });
    } finally {
      await sandbox.delete();
    }

    return sandbox;
  },
});
