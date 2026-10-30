import { commandMetadata } from "../command-metadata";
import * as cmd from "cmd-ts";
import { APIError, type Sandbox } from "@vercel/sandbox";
import { create, args as createArgs, requireCreatedSandbox } from "./create";
import { createContext } from "../args/create-context";
import { CliError } from "../util/cli-error";
import { exec, args as execArgs } from "./exec";
import { sandboxClient } from "../client";
import { StyledError } from "../error";
import { omit } from "../util/omit";

const args = {
  ...createArgs,
  // `timeout` is omitted because it collides with Create's `--timeout`
  // (sandbox lifetime).
  ...omit(execArgs, "sandbox", "timeout", "detached", "stdin"),
  scope: createContext({ allowJson: false }),
  removeAfterUse: cmd.flag({
    long: "rm",
    description: "Automatically remove the sandbox when the command exits.",
  }),
  stopAfterUse: cmd.flag({
    long: "stop",
    description: "Stop the sandbox when the command exits.",
  }),
} as const;

export const run = cmd.command({
  ...commandMetadata.run,
  args,
  async handler({ removeAfterUse, stopAfterUse, ...rest }) {
    if (
      rest.scope.creationRequested &&
      rest.interactive &&
      !rest.scope.mode.interactive
    ) {
      throw new CliError(
        "An interactive command cannot share stdin with a configuration payload. Create the sandbox first, then use sandbox exec from a terminal.",
      );
    }
    if (rest.scope.dryRun)
      throw new CliError("--dry-run is only supported by sandbox create.");
    if (removeAfterUse && stopAfterUse) {
      throw new Error("--rm and --stop are mutually exclusive.");
    }
    if (rest.runtime !== undefined && rest.image !== undefined) {
      throw new Error("--runtime and --image cannot be used together.");
    }

    let sandbox: Sandbox;

    // Resume an existing sandbox or otherwise create it.
    if (rest.name) {
      try {
        sandbox = await sandboxClient.get({
          name: rest.name,
          projectId: rest.scope.project,
          teamId: rest.scope.team,
          token: rest.scope.token,
          resume: !rest.scope.creationRequested,
          __includeSystemRoutes: true,
        });
        if (rest.scope.creationRequested)
          throw new CliError(
            "The named sandbox already exists. Creation inputs cannot change its source or credentials. Use sandbox exec, or choose a new --name.",
            { reason: "creation_options_on_existing_sandbox" },
          );
      } catch (error) {
        if (
          error instanceof StyledError &&
          error.cause instanceof APIError &&
          error.cause.response.status === 404
        ) {
          sandbox = requireCreatedSandbox(
            await create.handler({
              ...rest,
              agent: undefined,
              nonPersistent: rest.nonPersistent || removeAfterUse,
              __printConnectHint: false,
            } as Parameters<typeof create.handler>[0]),
          );
        } else {
          throw error;
        }
      }
    } else {
      sandbox = requireCreatedSandbox(
        await create.handler({
          ...rest,
          agent: undefined,
          nonPersistent: rest.nonPersistent || removeAfterUse,
          __printConnectHint: false,
        } as Parameters<typeof create.handler>[0]),
      );
    }

    try {
      await exec.handler({
        ...rest,
        sandbox,
        timeout: undefined,
        detached: false,
        stdin: false,
      });
    } finally {
      if (removeAfterUse) {
        await sandbox.delete();
      }
      if (stopAfterUse) {
        await sandbox.stop();
      }
    }
  },
});
