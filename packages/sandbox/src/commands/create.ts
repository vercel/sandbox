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
import {
  checkGatewayEnv,
  gatewayEnv,
  gatewayPolicy,
  gatewayTags,
  type GatewaySelection,
} from "../util/agent-gateway/policy";
import { resolveGatewayKey } from "../util/agent-gateway/credentials";
import { prepareAgent } from "../util/agent-gateway/config";
import { rememberGatewaySetup } from "../util/agent-gateway/runtime";

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
    ai: cmd.flag({
      long: "ai",
      description:
        "Request a managed AI Gateway session key; also configure coding agents on the universal image",
    }),
    useGatewayKey: cmd.flag({
      long: "use-gateway-key",
      description:
        "Use host AI_GATEWAY_API_KEY or a key saved by sandbox gateway setup (requires --ai)",
    }),
    agent: cmd.positional({
      displayName: "agent",
      description: `Open a coding agent in a new sandbox (${agentNames.join(", ")})`,
      type: cmd.optional(cmd.oneOf(agentNames)),
    }),
  },
  examples: [
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
      ai,
      useGatewayKey,
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
    if (useGatewayKey && !ai) {
      throw new Error("--use-gateway-key requires --ai.");
    }
    const launcher = agent ? agents[agent] : undefined;
    const selectedImage =
      image ?? (agent || ai ? "vercel/sandbox/universal" : undefined);
    const universalImage =
      /^(?:vcr\.vercel\.com\/)?vercel\/sandbox\/universal(?::[^/@\s]+|@sha256:[a-f0-9]{64})?$/.test(
        selectedImage ?? "",
      );
    const gatewaySelection: GatewaySelection = universalImage
      ? (agent ?? "all")
      : "none";
    if (ai) checkGatewayEnv(envVars, gatewaySelection);
    if (agent || ai) {
      if (
        runtime !== undefined ||
        snapshot !== undefined ||
        (!ai && image !== undefined)
      ) {
        throw new Error(
          `sandbox create ${agent ?? "--ai"} cannot be combined with ${ai ? "--runtime or --snapshot" : "--runtime, --image, or --snapshot"}.`,
        );
      }
      if (agent && image !== undefined && !universalImage) {
        throw new Error(
          "Agent shortcuts require the universal image. For a custom image, use --ai without an agent shortcut and launch your application with sandbox exec.",
        );
      }
      if (agent && (!isatty(0) || !isatty(1))) {
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

    let networkPolicy = buildNetworkPolicy({
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

    const runtimeOptions =
      selectedImage !== undefined
        ? { image: selectedImage }
        : runtime !== undefined
          ? { runtime }
          : {};

    const persistent = !nonPersistent;
    const resources = vcpus ? { vcpus } : undefined;
    let tagsObj = ai
      ? gatewayTags(tags, gatewaySelection)
      : Object.keys(tags).length > 0
        ? tags
        : undefined;
    let enableAiGateway: boolean | undefined;
    if (ai) {
      gatewayPolicy(networkPolicy, "validation-only");
      const key = useGatewayKey
        ? await resolveGatewayKey(scope, {
            durationMs: Math.max(ms(timeout), ms("24h")),
            optional: true,
          })
        : undefined;
      if (useGatewayKey && !key) {
        throw new Error(
          "No reusable Gateway key is configured. Run sandbox gateway setup or set AI_GATEWAY_API_KEY in your local environment, then retry with --ai --use-gateway-key. Omit --use-gateway-key to request a managed session key.",
        );
      }
      if (key && Object.values(envVars).some((value) => value.includes(key)))
        throw new Error(
          "Do not pass the Gateway key through --env. --ai injects it outside the sandbox.",
        );
      if (key) networkPolicy = gatewayPolicy(networkPolicy, key);
      else enableAiGateway = true;
      tagsObj = gatewayTags(tags, gatewaySelection, key);
    }
    const sandboxEnv = ai
      ? { ...envVars, ...gatewayEnv(gatewaySelection) }
      : envVars;
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
          enableAiGateway,
          env: sandboxEnv,
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
          ...runtimeOptions,
          timeout: ms(timeout),
          resources,
          networkPolicy,
          enableAiGateway,
          env: sandboxEnv,
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

    if (ai) {
      try {
        if (gatewaySelection !== "none")
          await prepareAgent(sandbox, gatewaySelection);
        rememberGatewaySetup(sandbox, gatewaySelection);
      } catch {
        throw new Error(
          `Gateway configuration failed for sandbox ${sandbox.name}. It remains available for inspection. Retry with sandbox exec --scope=${scope.team} --project=${scope.project} -i ${sandbox.name} -- ${agent ?? "bash"}, or stop it with sandbox stop ${sandbox.name}.`,
        );
      }
    }

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
      if (ai) {
        process.stderr.write(
          useGatewayKey
            ? "AI Gateway enabled with your own key. Stopping this sandbox will not revoke it.\n"
            : "AI Gateway enabled with a managed session key. Cleanup will revoke it when this session ends.\n",
        );
      }
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
          process.stderr.write(
            `\n${chalk.blue("ℹ")} Exiting ${launcher.displayName} does not stop the sandbox.\n`,
          );
          if (launcher.reconnectEnv === "explicit" && envFlags) {
            process.stderr.write(
              chalk.dim("   │ ") +
                "Before reconnecting, export the same --env values in your local shell. Values are not included in this hint.\n",
            );
          }
          process.stderr.write(
            chalk.dim("   │ ") +
              "Reconnect: " +
              chalk.cyan(
                `sandbox exec ${scopeFlags} --interactive${envFlags} ${sandbox.name} -- ${[launcher.command, ...launcher.reconnectArgs].join(" ")}`,
              ) +
              "\n",
          );
          process.stderr.write(
            chalk.dim("   ╰ ") +
              "Stop: " +
              chalk.cyan(`sandbox stop ${scopeFlags} ${sandbox.name}`) +
              "\n",
          );
        }
      }
    }

    return sandbox;
  },
});
