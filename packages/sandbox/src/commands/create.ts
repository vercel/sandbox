import * as cmd from "cmd-ts";
import { runtime } from "../args/runtime";
import ms from "ms";
import { timeout } from "../args/timeout";
import { vcpus } from "../args/vcpus";
import chalk from "chalk";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { snapshotId } from "../args/snapshot-id";
import { publishPorts } from "../args/ports";
import { snapshotRetentionArgs } from "../args/snapshot-retention";
import ora from "ora";
import * as Exec from "./exec";
import { networkPolicyArgs } from "../args/network-policy";
import { buildNetworkPolicy } from "../util/network-policy";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { buildKeepLastSnapshotsPayload } from "../util/keep-last-snapshots";
import { printSandboxSummary } from "../util/print-sandbox-summary";
import { mounts } from "../args/drive";

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
  ports: publishPorts,
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
  mounts,
  ...snapshotRetentionArgs,
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
    mounts,
    snapshotExpiration,
    keepLastSnapshots,
    keepLastSnapshotsFor,
    deleteEvictedSnapshots,
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

    const keepLastSnapshotsPayload = buildKeepLastSnapshotsPayload({
      keepLastSnapshots,
      keepLastSnapshotsFor,
      deleteEvictedSnapshots,
    });

    const persistent = !nonPersistent;
    const resources = vcpus ? { vcpus } : undefined;
    const tagsObj = Object.keys(tags).length > 0 ? tags : undefined;
    const mountsObj = Object.keys(mounts).length > 0 ? mounts : undefined;
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
          mounts: mountsObj,
          persistent,
          snapshotExpiration: snapshotExpiration ? ms(snapshotExpiration) : undefined,
          keepLastSnapshots: keepLastSnapshotsPayload,
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
          mounts: mountsObj,
          persistent,
          snapshotExpiration: snapshotExpiration ? ms(snapshotExpiration) : undefined,
          keepLastSnapshots: keepLastSnapshotsPayload,
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

    if (!silent) {
      printSandboxSummary({ sandbox, scope, action: "created" });
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
