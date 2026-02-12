import * as cmd from "cmd-ts";
import { runtime } from "../args/runtime";
import ms from "ms";
import { timeout } from "../args/timeout";
import chalk from "chalk";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { snapshotId } from "../args/snapshot-id";
import ora from "ora";
import * as Exec from "./exec";
import { networkPolicyArgs } from "../args/network-policy";
import { buildNetworkPolicy } from "../util/network-policy";

export const args = {
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
  snapshot: cmd.option({
    long: "snapshot",
    short: "s",
    description: "Start the sandbox from a snapshot ID",
    type: cmd.optional(snapshotId),
  }),
  connect: cmd.flag({
    long: "connect",
    description:
      "Start an interactive shell session after creating the sandbox",
  }),
  ...networkPolicyArgs,
  scope,
} as const;

export const create = cmd.command({
  name: "create",
  description: "Create a sandbox in the specified account and project.",
  args,
  examples: [
    {
      description: "Create and connect to a sandbox without a network access",
      command: `sandbox run --network-policy=none --connect`,
    },
  ],
  async handler({
    ports,
    scope,
    runtime,
    timeout,
    silent,
    snapshot,
    connect,
    networkPolicy: networkPolicyMode,
    allowedDomains,
    allowedCIDRs,
    deniedCIDRs,
  }) {
    const networkPolicy = buildNetworkPolicy({
      networkPolicy: networkPolicyMode,
      allowedDomains,
      allowedCIDRs,
      deniedCIDRs,
    });

    const spinner = silent ? undefined : ora("Creating sandbox...").start();
    const sandbox = snapshot
      ? await sandboxClient.create({
          source: { type: "snapshot", snapshotId: snapshot },
          teamId: scope.team,
          projectId: scope.project,
          token: scope.token,
          ports,
          timeout: ms(timeout),
          networkPolicy,
          __interactive: true,
        })
      : await sandboxClient.create({
          teamId: scope.team,
          projectId: scope.project,
          token: scope.token,
          ports,
          runtime,
          timeout: ms(timeout),
          networkPolicy,
          __interactive: true,
        });
    spinner?.stop();

    if (!sandbox.interactivePort) {
      throw new Error(
        [
          `Sandbox created but interactive port is missing.`,
          `${chalk.bold("hint:")} This is an internal error. Please try again.`,
          "╰▶ Report this issue: https://github.com/vercel/sandbox/issues",
        ].join("\n"),
      );
    }

    const routes = sandbox.routes.filter(
      (x) => x.port !== sandbox.interactivePort,
    );

    if (!silent) {
      const teamDisplay = scope.teamSlug ?? scope.team;
      const projectDisplay = scope.projectSlug ?? scope.project;
      const hasPorts = routes.length > 0;

      process.stderr.write("✅ Sandbox ");
      process.stdout.write(chalk.cyan(sandbox.sandboxId));
      process.stderr.write(" created.\n");
      process.stderr.write(
        chalk.dim("   │ ") + "team: " + chalk.cyan(teamDisplay) + "\n",
      );

      if (hasPorts) {
        process.stderr.write(
          chalk.dim("   │ ") + "project: " + chalk.cyan(projectDisplay) + "\n",
        );
        process.stderr.write(chalk.dim("   │ ") + "ports:\n");
        for (let i = 0; i < routes.length; i++) {
          const route = routes[i];
          const isLast = i === routes.length - 1;
          const prefix = isLast ? chalk.dim("   ╰ ") : chalk.dim("   │ ");
          process.stderr.write(
            prefix + "• " + route.port + " -> " + chalk.cyan(route.url) + "\n",
          );
        }
      } else {
        process.stderr.write(
          chalk.dim("   ╰ ") + "project: " + chalk.cyan(projectDisplay) + "\n",
        );
      }
    }

    if (connect) {
      await Exec.exec.handler({
        scope,
        asSudo: false,
        args: [],
        cwd: undefined,
        skipExtendingTimeout: false,
        envVars: {},
        command: "sh",
        interactive: true,
        tty: true,
        sandbox,
      });
    }

    return sandbox;
  },
});
