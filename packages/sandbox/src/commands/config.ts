import * as cmd from "cmd-ts";
import { Sandbox } from "@vercel/sandbox";
import { sandboxId } from "../args/sandbox-id";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import { networkPolicyArgs } from "../args/network-policy";
import { buildNetworkPolicy } from "../util/network-policy";
import ora from "ora";
import chalk from "chalk";

const networkPolicyCommand = cmd.command({
  name: "network-policy",
  description: `Update the network policy of a sandbox
  
This is a full update, fully overriding the pre-existing configuration.`,
  args: {
    scope,
    sandbox: cmd.positional({
      type: sandboxId as cmd.Type<string, string | Sandbox>,
    }),
    ...networkPolicyArgs,
  },
  async handler({
    scope: { token, team, project },
    sandbox: sandboxId,
    networkPolicy: networkPolicyMode,
    allowedDomains,
    allowedCIDRs,
    deniedCIDRs,
    injectionRules,
  }) {
    if (networkPolicyMode === undefined) {
      throw new Error(`Network policy mode must be set.`);
    }

    const networkPolicy = buildNetworkPolicy({
      networkPolicy: networkPolicyMode,
      allowedDomains,
      allowedCIDRs,
      deniedCIDRs,
      injectionRules,
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
      await sandbox.updateNetworkPolicy(networkPolicy);
      spinner.stop();

      process.stderr.write(
        "✅ Network policy updated for sandbox " +
          chalk.cyan(sandboxId) +
          "\n",
      );
      process.stderr.write(
        chalk.dim("   ╰ ") + "mode: " + chalk.cyan(networkPolicy.type) + "\n",
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
