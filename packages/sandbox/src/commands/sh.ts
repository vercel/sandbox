import { commandMetadata } from "../command-metadata";
import * as cmd from "cmd-ts";
import { create, args as createArgs, requireCreatedSandbox } from "./create";
import { createContext } from "../args/create-context";
import { CliError } from "../util/cli-error";
import { exec } from "./exec";
import { omit } from "../util/omit";
import { defaultShell } from "../interactive-shell/default-shell";

const args = {
  ...omit(createArgs, "connect"),
  scope: createContext({ allowJson: false }),
  removeAfterUse: cmd.flag({
    long: "rm",
    description: "Automatically remove the sandbox when the shell exits.",
  }),
} as const;

export const sh = cmd.command({
  ...commandMetadata.sh,
  args,
  async handler({ removeAfterUse, ...rest }) {
    if (rest.scope.creationRequested && !rest.scope.mode.interactive) {
      throw new CliError(
        "An interactive shell cannot share stdin with a configuration payload or run in non-interactive mode. Create the sandbox first, then use sandbox exec from a terminal.",
      );
    }
    if (rest.scope.dryRun)
      throw new CliError("--dry-run is only supported by sandbox create.");
    if (!removeAfterUse) {
      return create.handler({
        ...rest,
        agent: undefined,
        connect: true,
      });
    }

    const sandbox = requireCreatedSandbox(
      await create.handler({
        ...rest,
        agent: undefined,
        connect: false,
        nonPersistent: true,
        __printConnectHint: false,
      } as Parameters<typeof create.handler>[0]),
    );

    try {
      await exec.handler({
        ...defaultShell,
        scope: rest.scope,
        asSudo: false,
        cwd: undefined,
        skipExtendingTimeout: false,
        envVars: {},
        interactive: true,
        detached: false,
        stdin: false,
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
