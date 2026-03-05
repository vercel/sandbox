import * as cmd from "cmd-ts";
import type { Sandbox } from "@vercel/sandbox";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import {
  networkPolicyArgs,
  networkPolicyMode as networkPolicyModeType,
} from "../args/network-policy";
import { buildNetworkPolicy, resolveMode } from "../util/network-policy";
import { runtimeType } from "../args/runtime";
import { vcpus } from "../args/vcpus";
import { Duration } from "../types/duration";
import ora from "ora";
import chalk from "chalk";
import ms from "ms";
import { table } from "../util/output";
import { acquireRelease } from "../util/disposables";

const setCommand = cmd.command({
  name: "set",
  description: "Update the configuration of a sandbox",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to update",
    }),
    vcpus,
    runtime: cmd.option({
      long: "runtime",
      type: cmd.optional(runtimeType),
      description: "Runtime to use: node22, node24, or python3.13",
    }),
    timeout: cmd.option({
      long: "timeout",
      type: cmd.optional(Duration),
      description: "The maximum duration a sandbox can run for. Example: 5m, 1h",
    }),
    ...networkPolicyArgs,
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandbox: name,
    vcpus,
    runtime,
    timeout,
    networkPolicy: networkPolicyMode,
    allowedDomains,
    allowedCIDRs,
    deniedCIDRs,
  }) {
    const hasNetworkPolicyArgs =
      networkPolicyMode !== undefined ||
      allowedDomains.length > 0 ||
      allowedCIDRs.length > 0 ||
      deniedCIDRs.length > 0;

    if (
      vcpus === undefined &&
      runtime === undefined &&
      timeout === undefined &&
      !hasNetworkPolicyArgs
    ) {
      throw new Error(
        [
          `At least one option must be provided.`,
          `${chalk.bold("hint:")} Use --vcpus, --runtime, --timeout, or --network-policy to update the sandbox configuration.`,
        ].join("\n"),
      );
    }

    const networkPolicy = hasNetworkPolicyArgs
      ? buildNetworkPolicy({
          networkPolicy: networkPolicyMode,
          allowedDomains,
          allowedCIDRs,
          deniedCIDRs,
        })
      : undefined;

    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    const spinner = ora("Updating sandbox configuration...").start();
    try {
      await sandbox.update({
        ...(vcpus !== undefined && { resources: { vcpus } }),
        ...(runtime !== undefined && { runtime }),
        ...(timeout !== undefined && { timeout: ms(timeout) }),
        ...(networkPolicy !== undefined && { networkPolicy }),
      });
      spinner.succeed(
        "Configuration updated for sandbox " + chalk.cyan(name),
      );
    } catch (error) {
      spinner.stop();
      throw error;
    }
  },
});

const getCommand = cmd.command({
  name: "get",
  description: "Display the current configuration of a sandbox",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to inspect",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, sandbox: name }) {
    const sandbox = await (async () => {
      using _spinner = acquireRelease(
        () => ora("Fetching sandbox configuration...").start(),
        (s) => s.stop(),
      );
      return sandboxClient.get({
        name,
        projectId: project,
        teamId: team,
        token,
      });
    })();

    const memoryFormatter = new Intl.NumberFormat(undefined, {
      style: "unit",
      unit: "megabyte",
    });

    const rows = [
      { field: "Runtime", value: sandbox.runtime },
      { field: "vCPUs", value: String(sandbox.vcpus) },
      { field: "Memory", value: memoryFormatter.format(sandbox.memory) },
      { field: "Timeout", value: ms(sandbox.timeout, { long: true }) },
      { field: "Region", value: sandbox.region },
    ];

    console.log(
      table({
        rows,
        columns: {
          FIELD: { value: (r) => r.field, color: () => chalk.bold },
          VALUE: { value: (r) => r.value },
        },
      }),
    );
  },
});

const networkPolicyCommand = cmd.command({
  name: "network-policy",
  description: `Update the network policy of a sandbox.
  This will fully override the previous configuration.`,
  args: {
    sandbox: cmd.positional({
      type: sandboxName as cmd.Type<string, string | Sandbox>,
    }),
    ...networkPolicyArgs,
    mode: cmd.option({
      long: "mode",
      description: `Alias for --network-policy.`,
      type: cmd.optional(networkPolicyModeType),
    }),
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandbox: sandboxName,
    networkPolicy: networkPolicyFlag,
    mode: modeFlag,
    allowedDomains,
    allowedCIDRs,
    deniedCIDRs,
  }) {
    process.stderr.write(
      chalk.yellow(
        "Warning: 'config network-policy' is deprecated. Use 'config set --network-policy=...' instead.\n",
      ),
    );

    const networkPolicyMode = resolveMode(networkPolicyFlag, modeFlag);

    if (
      networkPolicyMode === undefined &&
      allowedDomains.length === 0 &&
      allowedCIDRs.length === 0 &&
      deniedCIDRs.length === 0
    ) {
      throw new Error(`Network policy mode or custom rules must be set.`);
    }

    const networkPolicy = buildNetworkPolicy({
      networkPolicy: networkPolicyMode,
      allowedDomains,
      allowedCIDRs,
      deniedCIDRs,
    });

    const sandbox =
      typeof sandboxName !== "string"
        ? sandboxName
        : await sandboxClient.get({
            name: sandboxName,
            projectId: project,
            teamId: team,
            token,
          });

    const spinner = ora("Updating network policy...").start();
    try {
      const response = await sandbox.updateNetworkPolicy(networkPolicy);
      spinner.stop();

      process.stderr.write(
        "✅ Network policy updated for sandbox " +
          chalk.cyan(sandbox.name) +
          "\n",
      );
      const mode = typeof response === "string" ? response : "restricted";
      process.stderr.write(
        chalk.dim("   ╰ ") + "mode: " + chalk.cyan(mode) + "\n",
      );
    } catch (error) {
      spinner.stop();
      throw error;
    }
  },
});

export const config = cmd.subcommands({
  name: "config",
  description: "View and update sandbox configuration",
  cmds: {
    set: setCommand,
    get: getCommand,
    "network-policy": networkPolicyCommand,
  },
});
