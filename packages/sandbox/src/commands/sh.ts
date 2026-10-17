import { commandMetadata } from "../command-metadata";
import * as cmd from "cmd-ts";
import { create, args as createArgs } from "./create";
import { exec } from "./exec";
import { omit } from "../util/omit";
import { defaultShell } from "../interactive-shell/default-shell";

const args = {
  ...omit(createArgs, "connect"),
  removeAfterUse: cmd.flag({
    long: "rm",
    description: "Automatically remove the sandbox when the shell exits.",
  }),
} as const;

export const sh = cmd.command({
  ...commandMetadata.sh,
  args,
  async handler({ removeAfterUse, ...rest }) {
    if (!removeAfterUse) {
      return create.handler({
        ...rest,
        agent: undefined,
        connect: true,
      });
    }

    const sandbox = await create.handler({
      ...rest,
      agent: undefined,
      connect: false,
      nonPersistent: true,
      __printConnectHint: false,
    } as Parameters<typeof create.handler>[0]);

    try {
      await exec.handler({
        ...defaultShell,
        scope: rest.scope,
        asSudo: false,
        cwd: undefined,
        skipExtendingTimeout: false,
        envVars: {},
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
