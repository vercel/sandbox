import * as cmd from "cmd-ts";
import { Listr } from "listr2";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";

export const remove = cmd.command({
  name: "remove",
  aliases: ["rm"],
  description: "Permanently remove one or more sandboxes",
  args: {
    sandboxName: cmd.positional({
      type: sandboxName,
      description: "a sandbox name to remove",
    }),
    sandboxNames: cmd.restPositionals({
      type: sandboxName,
      description: "more sandboxes to remove",
    }),
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandboxName,
    sandboxNames,
  }) {
    const tasks = Array.from(
      new Set([sandboxName, ...sandboxNames]),
      (name) => ({
        title: `Removing sandbox ${name}`,
        async task() {
          const sandbox = await sandboxClient.get({
            token,
            teamId: team,
            projectId: project,
            name,
          });
          await sandbox.delete();
        },
      }),
    );
    await new Listr(tasks, { concurrent: true }).run();
  },
});
