import * as cmd from "cmd-ts";
import ms from "ms";
import chalk from "chalk";
import ora from "ora";
import { vcpus } from "../args/vcpus";
import { Duration } from "../types/duration";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { sandboxName } from "../args/sandbox-name";
import * as Exec from "./exec";
import { networkPolicyArgs } from "../args/network-policy";
import { buildNetworkPolicy } from "../util/network-policy";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { SnapshotExpiration } from "../types/snapshot-expiration";

export const args = {
  source: cmd.positional({
    displayName: "source",
    description: "Name of the source sandbox to fork from.",
    type: sandboxName,
  }),
  name: cmd.option({
    long: "name",
    description: "A user-chosen name for the forked sandbox. Must be unique per project.",
    type: cmd.optional(cmd.string),
  }),
  nonPersistent: cmd.flag({
    long: "non-persistent",
    description: "Disable automatic restore of the filesystem between sessions.",
  }),
  timeout: cmd.option({
    long: "timeout",
    type: cmd.optional(Duration),
    description:
      "Override the maximum sandbox runtime (inherited from source if omitted). Example: 5m, 30m",
  }),
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
  connect: cmd.flag({
    long: "connect",
    description:
      "Start an interactive shell session after creating the forked sandbox",
  }),
  envVars: cmd.multioption({
    long: "env",
    short: "e",
    type: ObjectFromKeyValue,
    description:
      "Environment variables to set on the fork. Env vars from the source sandbox are not copied (encrypted server-side).",
  }),
  tags: cmd.multioption({
    long: "tag",
    short: "t",
    type: ObjectFromKeyValue,
    description:
      "Key-value tags to associate with the fork (overrides tags copied from the source)",
  }),
  snapshotExpiration: cmd.option({
    long: "snapshot-expiration",
    type: cmd.optional(SnapshotExpiration),
    description:
      'Default snapshot expiration. Use "none" or 0 for no expiration. Example: 7d, 30d',
  }),
  keepLastSnapshots: cmd.option({
    long: "keep-last-snapshots",
    type: cmd.optional(
      cmd.extendType(cmd.number, {
        displayName: "COUNT",
        async from(n) {
          if (!Number.isInteger(n) || n < 1 || n > 10) {
            throw new Error(
              `Invalid --keep-last-snapshots value: ${n}. Must be an integer between 1 and 10.`,
            );
          }
          return n;
        },
      }),
    ),
    description:
      "Keep only the N most recent snapshots of the fork (1-10).",
  }),
  keepLastSnapshotsFor: cmd.option({
    long: "keep-last-snapshots-for",
    type: cmd.optional(SnapshotExpiration),
    description:
      'Expiration applied to kept snapshots. Use "none" or 0 for no expiration. Example: 7d, 30d',
  }),
  deleteEvictedSnapshots: cmd.option({
    long: "delete-evicted-snapshots",
    type: cmd.optional({
      ...cmd.oneOf(["true", "false"]),
      displayName: "true|false",
    }),
    description:
      'When "true" (the default), evicted snapshots are deleted immediately; when "false", they keep the default expiration.',
  }),
  ...networkPolicyArgs,
  scope,
} as const;

export const fork = cmd.command({
  name: "fork",
  description:
    "Fork an existing sandbox into a new one. Copies config (cpu, timeout, network policy, tags, etc.) from the source sandbox; env vars are NOT copied and must be re-supplied via --env.",
  args,
  examples: [
    {
      description: "Fork a sandbox with all config copied from the source",
      command: `sandbox fork my-source`,
    },
    {
      description: "Fork with a specific name and overridden vcpus",
      command: `sandbox fork my-source --name experiment-1 --vcpus 4`,
    },
  ],
  async handler({
    source,
    name,
    nonPersistent,
    ports,
    scope,
    timeout,
    vcpus,
    silent,
    connect,
    envVars,
    tags,
    snapshotExpiration,
    keepLastSnapshots,
    keepLastSnapshotsFor,
    deleteEvictedSnapshots,
    networkPolicy: networkPolicyMode,
    allowedDomains,
    allowedCIDRs,
    deniedCIDRs,
  }) {
    const networkPolicyProvided =
      networkPolicyMode !== undefined ||
      allowedDomains.length > 0 ||
      allowedCIDRs.length > 0 ||
      deniedCIDRs.length > 0;
    const networkPolicy = networkPolicyProvided
      ? buildNetworkPolicy({
          networkPolicy: networkPolicyMode,
          allowedDomains,
          allowedCIDRs,
          deniedCIDRs,
        })
      : undefined;

    if (
      keepLastSnapshots === undefined &&
      (keepLastSnapshotsFor !== undefined ||
        deleteEvictedSnapshots !== undefined)
    ) {
      throw new Error(
        [
          "--keep-last-snapshots-for and --delete-evicted-snapshots require --keep-last-snapshots.",
          `${chalk.bold("hint:")} Pass --keep-last-snapshots <count> to enable the retention policy.`,
        ].join("\n"),
      );
    }

    const keepLastSnapshotsPayload =
      keepLastSnapshots !== undefined
        ? {
            count: keepLastSnapshots,
            expiration:
              keepLastSnapshotsFor !== undefined
                ? ms(keepLastSnapshotsFor)
                : undefined,
            deleteEvicted:
              deleteEvictedSnapshots !== undefined
                ? deleteEvictedSnapshots === "true"
                : undefined,
          }
        : undefined;

    const tagsObj = Object.keys(tags).length > 0 ? tags : undefined;
    const envObj = Object.keys(envVars).length > 0 ? envVars : undefined;

    const spinner = silent
      ? undefined
      : ora(`Forking sandbox ${chalk.cyan(source)}...`).start();
    const sandbox = await sandboxClient.fork({
      source,
      teamId: scope.team,
      projectId: scope.project,
      token: scope.token,
      ...(name !== undefined && { name }),
      ...(ports.length > 0 && { ports }),
      ...(timeout !== undefined && { timeout: ms(timeout) }),
      ...(vcpus !== undefined && { resources: { vcpus } }),
      ...(networkPolicy !== undefined && { networkPolicy }),
      ...(envObj !== undefined && { env: envObj }),
      ...(tagsObj !== undefined && { tags: tagsObj }),
      ...(nonPersistent && { persistent: false }),
      ...(snapshotExpiration !== undefined && {
        snapshotExpiration: ms(snapshotExpiration),
      }),
      ...(keepLastSnapshotsPayload !== undefined && {
        keepLastSnapshots: keepLastSnapshotsPayload,
      }),
      __interactive: true,
    });
    spinner?.stop();

    if (!sandbox.interactivePort) {
      throw new Error(
        [
          `Sandbox forked but interactive port is missing.`,
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
      process.stderr.write(" forked from " + chalk.cyan(source) + ".\n");
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
