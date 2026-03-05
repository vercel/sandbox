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
import { vcpusType } from "../args/vcpus";
import { Duration } from "../types/duration";
import ora from "ora";
import chalk from "chalk";
import ms from "ms";
import { table } from "../util/output";
import { acquireRelease } from "../util/disposables";

const vcpusCommand = cmd.command({
  name: "vcpus",
  description: "Update the vCPU count of a sandbox",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to update",
    }),
    count: cmd.positional({
      type: vcpusType,
      description:
        "Number of vCPUs to allocate (each vCPU includes 2048 MB of memory)",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, sandbox: name, count }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    const spinner = ora("Updating sandbox configuration...").start();
    try {
      await sandbox.update({ resources: { vcpus: count } });
      spinner.stop();

      process.stderr.write(
        "✅ Configuration updated for sandbox " +
          chalk.cyan(name) +
          "\n",
      );
      process.stderr.write(
        chalk.dim("   ╰ ") + "vcpus: " + chalk.cyan(count) + "\n",
      );
    } catch (error) {
      spinner.stop();
      throw error;
    }
  },
});

const timeoutCommand = cmd.command({
  name: "timeout",
  description: "Update the timeout of a sandbox (will be applied to all new sessions)",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to update",
    }),
    duration: cmd.positional({
      type: Duration,
      description: "The maximum duration a sandbox can run for. Example: 5m, 1h",
    }),
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandbox: name,
    duration,
  }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    const spinner = ora("Updating sandbox configuration...").start();
    try {
      await sandbox.update({ timeout: ms(duration) });
      spinner.stop();

      process.stderr.write(
        "✅ Configuration updated for sandbox " +
          chalk.cyan(name) +
          "\n",
      );
      process.stderr.write(
        chalk.dim("   ╰ ") + "timeout: " + chalk.cyan(duration) + "\n",
      );
    } catch (error) {
      spinner.stop();
      throw error;
    }
  },
});

const persistentCommand = cmd.command({
  name: "persistent",
  description: "Enable or disable automatic restore of the filesystem between sessions",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to update",
    }),
    value: cmd.positional({
      type: { ...cmd.oneOf(["true", "false"]), displayName: "true|false" },
      description: "Enable or disable automatic restore of the filesystem between sessions",
    }),
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandbox: name,
    value,
  }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    const spinner = ora("Updating sandbox configuration...").start();
    try {
      await sandbox.update({ persistent: value === "true" });
      spinner.stop();

      process.stderr.write(
        "✅ Configuration updated for sandbox " +
          chalk.cyan(name) +
          "\n",
      );
      process.stderr.write(
        chalk.dim("   ╰ ") + "persistent: " + chalk.cyan(value) + "\n",
      );
    } catch (error) {
      spinner.stop();
      throw error;
    }
  },
});

const listCommand = cmd.command({
  name: "list",
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

    const networkPolicy = typeof sandbox.networkPolicy === "string" ? sandbox.networkPolicy : "restricted";
    const rows = [
      { field: "vCPUs", value: String(sandbox.vcpus) },
      { field: "Timeout", value: ms(sandbox.timeout, { long: true }) },
      { field: "Persistent", value: String(sandbox.persistent) },
      { field: "Network policy", value: String(networkPolicy) },
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
  description: `Update the network policy of a sandbox`,
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
      await sandbox.update({ networkPolicy });
      spinner.stop();

      process.stderr.write(
        "✅ Network policy updated for sandbox " +
          chalk.cyan(sandbox.name) +
          "\n",
      );
      const mode = typeof networkPolicy === "string" ? networkPolicy : "restricted";
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
    list: listCommand,
    vcpus: vcpusCommand,
    timeout: timeoutCommand,
    persistent: persistentCommand,
    "network-policy": networkPolicyCommand,
  },
});
