import * as cmd from "cmd-ts";
import { isatty } from "node:tty";
import ms from "ms";
import { runtime } from "../args/runtime";
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
import { startLatestVersionCheck } from "../util/check-latest-version";
import { region, failoverRegions } from "../args/region";
import { networkId } from "../args/network-id";
import { defaultShell } from "../interactive-shell/default-shell";
import { agentNames, agents } from "./agents";

export const args = {
  name: cmd.option({
    long: "name",
    description:
      "A user-chosen name for the sandbox. It must be unique per project.",
    type: cmd.optional(cmd.string),
  }),
  nonPersistent: cmd.flag({
    long: "non-persistent",
    description:
      "Disable automatic restore of the filesystem between sessions.",
  }),
  runtime,
  image: cmd.option({
    long: "image",
    description:
      "A Vercel Container Registry (VCR) image name and optional tag or sha to start the sandbox from (e.g. my-repo, my-repo:v1).",
    type: cmd.optional(cmd.string),
  }),
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
    description:
      "Key-value tags to associate with the sandbox (e.g. --tag env=staging)",
  }),
  mounts,
  region,
  failoverRegions,
  networkId,
  ...snapshotRetentionArgs,
  ...networkPolicyArgs,
  scope,
} as const;

export const create = cmd.command({
  name: "create",
  description: "Create a sandbox in the specified account and project.",
  args: {
    ...args,
    agent: cmd.positional({
      displayName: "agent",
      description: `Open a coding agent in a new sandbox (${agentNames.join(", ")})`,
      type: cmd.optional(cmd.oneOf(agentNames)),
    }),
  },
  examples: [
    {
      description: "Create a sandbox and open Codex",
      command: "sandbox create codex",
    },
    {
      description: "Create a sandbox and open Claude Code",
      command: "sandbox create claude",
    },
    {
      description: "Create a sandbox and open OpenCode",
      command: "sandbox create opencode",
    },
    {
      description:
        "Create a sandbox on a Secure Compute network (requires an Enterprise plan)",
      command: `sandbox create --network-id your_network_id_here`,
    },
    {
      description: "Create and connect to a sandbox without a network access",
      command: `sandbox run --network-policy=none --connect`,
    },
  ],
  async handler(input) {
    const {
      agent,
      name,
      nonPersistent,
      ports,
      scope,
      runtime,
      image,
      timeout,
      vcpus,
      silent,
      snapshot,
      connect,
      envVars,
      tags,
      mounts,
      region,
      failoverRegions,
      networkId,
      snapshotExpiration,
      keepLastSnapshots,
      keepLastSnapshotsFor,
      deleteEvictedSnapshots,
      networkPolicy: networkPolicyMode,
      allowedDomains,
      allowedCIDRs,
      deniedCIDRs,
    } = input;
    // Internal flag for composing commands (e.g. `run`) that create a sandbox
    // as a step rather than as the outcome, where a connect hint would mislead.
    const { __printConnectHint = true } = input as {
      __printConnectHint?: boolean;
    };
    const launcher = agent ? agents[agent] : undefined;
    if (agent) {
      if (
        runtime !== undefined ||
        image !== undefined ||
        snapshot !== undefined
      ) {
        throw new Error(
          `sandbox create ${agent} cannot be combined with --runtime, --image, or --snapshot.`,
        );
      }
      if (!isatty(0) || !isatty(1)) {
        throw new Error(
          `sandbox create ${agent} requires a terminal (TTY). Run it in an interactive terminal.`,
        );
      }
    }
    if (runtime !== undefined && image !== undefined) {
      throw new Error("--runtime and --image cannot be used together.");
    }

    // Look up the latest published CLI version while the creation request is
    // in flight, so stale installs learn they're behind at no latency cost.
    const versionCheck = silent ? undefined : startLatestVersionCheck();

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
          region,
          failoverRegions,
          networkId,
          persistent,
          snapshotExpiration: snapshotExpiration
            ? ms(snapshotExpiration)
            : undefined,
          keepLastSnapshots: keepLastSnapshotsPayload,
          __interactive: true,
        })
      : await sandboxClient.create({
          name,
          teamId: scope.team,
          projectId: scope.project,
          token: scope.token,
          ports,
          ...(agent
            ? { image: "vercel/sandbox/universal" }
            : image !== undefined
              ? { image }
              : runtime !== undefined
                ? { runtime }
                : {}),
          timeout: ms(timeout),
          resources,
          networkPolicy,
          env: envVars,
          tags: tagsObj,
          mounts: mountsObj,
          region,
          failoverRegions,
          networkId,
          persistent,
          snapshotExpiration: snapshotExpiration
            ? ms(snapshotExpiration)
            : undefined,
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
      printSandboxSummary({
        sandbox,
        scope,
        action: "created",
        connectHint: !agent && !connect && __printConnectHint,
      });
      versionCheck?.report();
    }

    if (agent || connect) {
      try {
        if (launcher) {
          try {
            const check = await sandbox.runCommand({
              cmd: launcher.command,
              args: ["--version"],
              env: { ...launcher.env, ...envVars },
            });
            if (check.exitCode !== 0) {
              throw new Error(
                `Version check exited with code ${check.exitCode}.`,
              );
            }
          } catch (cause) {
            throw new Error(
              `Unable to start ${launcher.displayName} (${launcher.command}) in the sandbox.`,
              { cause },
            );
          }
        }
        await Exec.exec.handler({
          ...(launcher
            ? { command: launcher.command, args: launcher.args }
            : defaultShell),
          scope,
          asSudo: false,
          cwd: undefined,
          skipExtendingTimeout: false,
          envVars: launcher ? { ...launcher.env, ...envVars } : {},
          interactive: true,
          tty: true,
          sandbox,
          timeout: undefined,
        });
      } finally {
        if (launcher && !silent) {
          const scopeFlags = `--scope=${scope.team} --project=${scope.project}`;
          const envFlags =
            launcher.reconnectEnv === "explicit"
              ? Object.keys(envVars)
                  .map((key) => ` --env='${key.replaceAll("'", "'\\''")}'`)
                  .join("")
              : Object.entries(launcher.env)
                  .map(([key, value]) => ` --env=${key}=${value}`)
                  .join("");
          console.error(
            `\nExiting ${launcher.displayName} does not stop the sandbox.`,
          );
          if (launcher.reconnectEnv === "explicit" && envFlags) {
            console.error(
              "Before reconnecting, export the same --env values in your local shell. Values are not included in this hint.",
            );
          }
          console.error(
            `Reconnect: sandbox exec ${scopeFlags} --interactive${envFlags} ${sandbox.name} -- ${[launcher.command, ...launcher.reconnectArgs].join(" ")}`,
          );
          console.error(`Stop: sandbox stop ${scopeFlags} ${sandbox.name}`);
        }
      }
    }

    return sandbox;
  },
});
