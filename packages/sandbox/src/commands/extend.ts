import { commandMetadata } from "../command-metadata";
import * as cmd from "cmd-ts";
import chalk from "chalk";
import ms from "ms";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { Duration } from "../types/duration";

export const extend = cmd.command({
  ...commandMetadata.extend,
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name with a running session",
    }),
    duration: cmd.positional({
      type: Duration,
      description: "Time to add, for example 5m or 1h",
    }),
    scope,
  },
  examples: [
    { description: "Add 30 minutes", command: "sandbox extend my-sandbox 30m" },
  ],
  async handler({ scope: { token, team, project }, sandbox: name, duration }) {
    const extension = ms(duration);
    if (extension <= 0) {
      throw new Error("Extension duration must be greater than zero.");
    }

    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
      resume: false,
    });
    const session = (() => {
      try {
        return sandbox.currentSession();
      } catch {
        return null;
      }
    })();
    if (session?.status !== "running") {
      throw new Error(`Sandbox ${name} has no running session to extend.`);
    }

    await session.extendTimeout(extension);
    process.stderr.write(
      chalk.green("✔") + ` Extended ${chalk.cyan(name)} by ${duration}\n`,
    );
  },
});
