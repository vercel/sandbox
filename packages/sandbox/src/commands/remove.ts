import * as cmd from "cmd-ts";
import { Listr } from "listr2";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";

export const remove = cmd.command({
  name: "rm",
  aliases: ["remove"],
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
    preserveSnapshots: cmd.flag({
      long: "preserve-snapshots",
      description: "Keep snapshots when deleting the sandbox",
    }),
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandboxName,
    sandboxNames,
    preserveSnapshots,
  }) {
    const tasks = Array.from(
      new Set([sandboxName, ...sandboxNames]),
      (name) => ({
        title: `Deleting sandbox ${name}`,
        async task() {
          const sandbox = await sandboxClient.get({
            token,
            teamId: team,
            projectId: project,
            name,
          });
          await sandbox.delete({ preserveSnapshots });
        },
      }),
    );
    await new Listr(tasks, { concurrent: true }).run();
  },
});
