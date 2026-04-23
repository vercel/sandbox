import * as cmd from "cmd-ts";
import { runtime } from "../args/runtime";
import ms from "ms";
import { timeout } from "../args/timeout";
import { vcpus } from "../args/vcpus";
import chalk from "chalk";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { snapshotId } from "../args/snapshot-id";
import ora from "ora";
import * as Exec from "./exec";
import { networkPolicyArgs } from "../args/network-policy";
import { buildNetworkPolicy } from "../util/network-policy";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { SnapshotExpiration } from "../types/snapshot-expiration";

export const args = {
  name: cmd.option({
    long: "name",
    description: "A user-chosen name for the sandbox. It must be unique per project.",
    type: cmd.optional(cmd.string),
  }),
  nonPersistent: cmd.flag({
    long: "non-persistent",
    description: "Disable automatic restore of the filesystem between sessions.",
  }),
  runtime,
  timeout,
  vcpus,
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
    description: "Don't write sandbox name to stdout",
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
  envVars: cmd.multioption({
    long: "env",
    short: "e",
    type: ObjectFromKeyValue,
    description: "Default environment variables for sandbox commands",
  }),
  tags: cmd.multioption({
    long: "tag",
    short: "t",
    type: ObjectFromKeyValue,
    description: "Key-value tags to associate with the sandbox (e.g. --tag env=staging)",
  }),
  snapshotExpiration: cmd.option({
    long: "snapshot-expiration",
    type: cmd.optional(SnapshotExpiration),
    description: 'Default snapshot expiration. Use "none" or 0 for no expiration. Example: 7d, 30d',
  }),
  keepLast: cmd.option({
    long: "keep-last",
    type: cmd.optional(
      cmd.extendType(cmd.number, {
        displayName: "COUNT",
        async from(n) {
          if (!Number.isInteger(n) || n < 1 || n > 10) {
            throw new Error(
              `Invalid --keep-last value: ${n}. Must be an integer between 1 and 10.`,
            );
          }
          return n;
        },
      }),
    ),
    description:
      "Keep only the N most recent snapshots of this sandbox (1-10).",
  }),
  keepLastFor: cmd.option({
    long: "keep-last-for",
    type: cmd.optional(SnapshotExpiration),
    description:
      'Expiration applied to kept snapshots. Use "none" or 0 for no expiration. Example: 7d, 30d',
  }),
  softEvict: cmd.flag({
    long: "soft-evict",
    description:
      "Evicted snapshots keep the default expiration instead of being deleted immediately.",
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
    name,
    nonPersistent,
    ports,
    scope,
    runtime,
    timeout,
    vcpus,
    silent,
    snapshot,
    connect,
    envVars,
    tags,
    snapshotExpiration,
    keepLast,
    keepLastFor,
    softEvict,
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

    if (keepLast === undefined && (keepLastFor !== undefined || softEvict)) {
      throw new Error(
        [
          "--keep-last-for and --soft-evict require --keep-last.",
          `${chalk.bold("hint:")} Pass --keep-last <count> to enable the retention policy.`,
        ].join("\n"),
      );
    }

    const snapshotKeepLastPayload =
      keepLast !== undefined
        ? {
            count: keepLast,
            expiration:
              keepLastFor !== undefined ? ms(keepLastFor) : undefined,
            deleteEvicted: softEvict ? false : undefined,
          }
        : undefined;

    const persistent = !nonPersistent
    const resources = vcpus ? { vcpus } : undefined;
    const tagsObj = Object.keys(tags).length > 0 ? tags : undefined;
    const spinner = silent ? undefined : ora("Creating sandbox...").start();
    const sandbox = snapshot
      ? await sandboxClient.create({
          name,
          source: { type: "snapshot", snapshotId: snapshot },
          teamId: scope.team,
          projectId: scope.project,
          token: scope.token,
          ports,
          timeout: ms(timeout),
          resources,
          networkPolicy,
          env: envVars,
          tags: tagsObj,
          persistent,
          snapshotExpiration: snapshotExpiration ? ms(snapshotExpiration) : undefined,
          snapshotKeepLast: snapshotKeepLastPayload,
          __interactive: true,
        })
      : await sandboxClient.create({
          name,
          teamId: scope.team,
          projectId: scope.project,
          token: scope.token,
          ports,
          runtime,
          timeout: ms(timeout),
          resources,
          networkPolicy,
          env: envVars,
          tags: tagsObj,
          persistent,
          snapshotExpiration: snapshotExpiration ? ms(snapshotExpiration) : undefined,
          snapshotKeepLast: snapshotKeepLastPayload,
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
      process.stdout.write(chalk.cyan(sandbox.name));
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
