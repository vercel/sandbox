import * as cmd from "cmd-ts";
import { APIError, type Sandbox } from "@vercel/sandbox";
import * as Create from "./create";
import * as Exec from "./exec";
import { sandboxClient } from "../client";
import { StyledError } from "../error";
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
    let sandbox: Sandbox;

    // Resume an existing sandbox or otherwise create it.
    if (rest.name) {
      try {
        sandbox = await sandboxClient.get({
          name: rest.name,
          projectId: rest.scope.project,
          teamId: rest.scope.team,
          token: rest.scope.token,
          resume: true,
          __includeSystemRoutes: true,
        });
      } catch (error) {
        if (error instanceof StyledError && error.cause instanceof APIError && error.cause.response.status === 404) {
          sandbox = await Create.create.handler({ ...rest });
        } else {
          throw error;
        }
      }
    } else {
      sandbox = await Create.create.handler({ ...rest });
    }

    try {
      await Exec.exec.handler({ ...rest, sandbox });
    } finally {
      if (removeAfterUse) {
        await sandbox.delete();
      }
    }
  },
});
