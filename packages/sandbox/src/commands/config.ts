import * as cmd from "cmd-ts";
import { Sandbox } from "@vercel/sandbox";
import { sandboxId } from "../args/sandbox-id";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import {
  networkPolicyArgs,
  networkPolicyMode as networkPolicyModeType,
} from "../args/network-policy";
import { buildNetworkPolicy, resolveMode } from "../util/network-policy";
import ora from "ora";
import chalk from "chalk";

const networkPolicyCommand = cmd.command({
  name: "network-policy",
  description: `Update the network policy of a sandbox.
  This will fully override the previous configuration.`,
  args: {
    sandbox: cmd.positional({
      type: sandboxId as cmd.Type<string, string | Sandbox>,
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
    sandbox: sandboxId,
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
      typeof sandboxId !== "string"
        ? sandboxId
        : await sandboxClient.get({
            sandboxId,
            projectId: project,
            teamId: team,
            token,
          });

    if (!["pending", "running"].includes(sandbox.status)) {
      console.error(
        [
          `Sandbox ${sandbox.sandboxId} is not available (status: ${sandbox.status}).`,
          `${chalk.bold("hint:")} Only 'pending' or 'running' sandboxes can execute commands.`,
          "├▶ Use `sandbox list` to check sandbox status.",
          "╰▶ Use `sandbox create` to create a new sandbox.",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }

    const spinner = ora("Updating network policy...").start();
    try {
      const response = await sandbox.updateNetworkPolicy(networkPolicy);
      spinner.stop();

      process.stderr.write(
        "✅ Network policy updated for sandbox " +
          chalk.cyan(sandbox.sandboxId) +
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
  description: "Update a sandbox configuration",
  cmds: {
    "network-policy": networkPolicyCommand,
  },
});
