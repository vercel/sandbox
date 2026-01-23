import * as cmd from "cmd-ts";
import { runtime } from "../args/runtime";
import ms from "ms";
import { timeout } from "../args/timeout";
import chalk from "chalk";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";

export const args = {
  scope,
  runtime,
  timeout,
  ports: cmd.multioption({
    long: "publish-port",
    short: "p",
    description: "Publish sandbox port(s) to DOMAIN.vercel.run",
    type: cmd.array(
      cmd.extendType(cmd.number, {
        displayName: "PORT",
        async from(number) {
          if (number < 1024 || number > 65535) {
            throw new Error(
              [
                `Invalid port: ${number}.`,
                `${chalk.bold("hint:")} Ports must be between 1024-65535 (privileged ports 0-1023 are reserved).`,
                "╰▶ Examples: 3000, 8080, 8443",
              ].join("\n"),
            );
          }
          return number;
        },
      }),
    ),
  }),
  silent: cmd.flag({
    long: "silent",
    description: "Don't write sandbox ID to stdout",
  }),
} as const;

export const create = cmd.command({
  name: "create",
  description: "Create a sandbox in the specified account and project.",
  args,
  async handler({ ports, scope, runtime, timeout, silent }) {
    const sandbox = await sandboxClient.create({
      teamId: scope.team,
      projectId: scope.project,
      token: scope.token,
      ports,
      runtime,
      timeout: ms(timeout),
      __interactive: true,
    });

    if (!silent) {
      process.stderr.write("✅ Sandbox ");
      process.stdout.write(chalk.cyan(sandbox.sandboxId));
      process.stderr.write(" created.\n");
    }

    if (!sandbox.interactivePort) {
      throw new Error(
        [
          `Sandbox created but interactive port is missing.`,
          `${chalk.bold("hint:")} This is an internal error. Please try again.`,
          "╰▶ Report this issue: https://github.com/vercel/sandbox-sdk/issues",
        ].join("\n"),
      );
    }

    const routes = sandbox.routes.filter(
      (x) => x.port !== sandbox.interactivePort,
    );

    if (routes.length) {
      console.log();
      console.log(chalk.bold("Mapped ports:"));
      for (const route of routes) {
        console.log(`  • ${route.port} -> ${route.url}`);
      }
    }

    return sandbox;
  },
});
