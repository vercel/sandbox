import * as cmd from "cmd-ts";
import ms from "ms";
import chalk from "chalk";
import ora from "ora";
import { vcpus } from "../args/vcpus";
import { Duration } from "../types/duration";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { sandboxName } from "../args/sandbox-name";
import { publishPorts } from "../args/ports";
import { snapshotRetentionArgs } from "../args/snapshot-retention";
import * as Exec from "./exec";
import { networkPolicyArgs } from "../args/network-policy";
import { buildNetworkPolicy } from "../util/network-policy";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { buildKeepLastSnapshotsPayload } from "../util/keep-last-snapshots";
import { printSandboxSummary } from "../util/print-sandbox-summary";

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
  ports: publishPorts,
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
      "Key-value tags to associate with the fork. When provided, fully replaces the tags copied from the source (no per-key merge).",
  }),
  ...snapshotRetentionArgs,
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
      command: `sandbox fork my-source --name my-forked-sandbox --vcpus 4`,
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

    const keepLastSnapshotsPayload = buildKeepLastSnapshotsPayload({
      keepLastSnapshots,
      keepLastSnapshotsFor,
      deleteEvictedSnapshots,
    });

    const tagsObj = Object.keys(tags).length > 0 ? tags : undefined;
    const envObj = Object.keys(envVars).length > 0 ? envVars : undefined;

    const spinner = silent
      ? undefined
      : ora(`Forking sandbox ${chalk.cyan(source)}...`).start();
    const sandbox = await sandboxClient.fork({
      sourceSandbox: source,
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

    if (!silent) {
      printSandboxSummary({
        sandbox,
        scope,
        action: `forked from ${chalk.cyan(source)}`,
      });
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
        timeout: undefined,
      });
    }

    return sandbox;
  },
});
