import * as cmd from "cmd-ts";
import { Listr } from "listr2";
import { sandboxId } from "../args/sandbox-id";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";

export const stop = cmd.command({
  name: "stop",
  aliases: ["rm", "remove"],
  description: "Stop one or more running sandboxes",
  args: {
    sandboxId: cmd.positional({
      type: sandboxId,
      description: "a sandbox ID to stop",
    }),
    sandboxIds: cmd.restPositionals({
      type: sandboxId,
      description: "more sandboxes to stop",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, sandboxId, sandboxIds }) {
    const tasks = Array.from(
      new Set([sandboxId, ...sandboxIds]),
      (sandboxId) => {
        return {
          title: `Stopping sandbox ${sandboxId}`,
          async task() {
            const sandbox = await sandboxClient.get({
              token,
              teamId: team,
              projectId: project,
              sandboxId,
            });
            await sandbox.stop();
          },
        };
      },
    );
    await new Listr(tasks, { concurrent: true }).run();
  },
});
