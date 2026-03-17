import * as cmd from "cmd-ts";
import { Listr } from "listr2";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";

export const stop = cmd.command({
  name: "stop",
  description: "Stop the current session of one or more sandboxes",
  args: {
    sandboxName: cmd.positional({
      type: sandboxName,
      description: "A sandbox name to stop",
    }),
    sandboxNames: cmd.restPositionals({
      type: sandboxName,
      description: "More sandboxes to stop",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, sandboxName, sandboxNames }) {
    const tasks = Array.from(
      new Set([sandboxName, ...sandboxNames]),
      (sandboxName) => {
        return {
          title: `Stopping active session from ${sandboxName}`,
          async task() {
            const sandbox = await sandboxClient.get({
              token,
              teamId: team,
              projectId: project,
              name: sandboxName,
            });
            await sandbox.stop();
          },
        };
      },
    );
    try {
      await new Listr(tasks, { concurrent: true }).run();
    } catch {
      // Listr already rendered the error; just set exit code
      process.exitCode = 1;
    }
  },
});
