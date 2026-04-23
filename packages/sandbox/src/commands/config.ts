import * as cmd from "cmd-ts";
import { APIError, type Sandbox } from "@vercel/sandbox";
import { sandboxName } from "../args/sandbox-name";
import { snapshotId } from "../args/snapshot-id";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";
import {
  networkPolicyArgs,
  networkPolicyMode as networkPolicyModeType,
} from "../args/network-policy";
import { buildNetworkPolicy, resolveMode } from "../util/network-policy";
import { vcpusType } from "../args/vcpus";
import { Duration } from "../types/duration";
import { SnapshotExpiration } from "../types/snapshot-expiration";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import ora from "ora";
import chalk from "chalk";
import ms from "ms";
import { table } from "../util/output";
import { acquireRelease } from "../util/disposables";
import { StyledError } from "../error";

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

const snapshotExpirationCommand = cmd.command({
  name: "snapshot-expiration",
  description: "Update the default snapshot expiration of a sandbox",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to update",
    }),
    duration: cmd.positional({
      type: SnapshotExpiration,
      description: 'Snapshot expiration duration (e.g. 7d, 30d) or "none" for no expiration',
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
      await sandbox.update({ snapshotExpiration: ms(duration) });
      spinner.stop();

      const display = ms(duration) === 0 ? "none" : duration;
      process.stderr.write(
        "✅ Configuration updated for sandbox " +
          chalk.cyan(name) +
          "\n",
      );
      process.stderr.write(
        chalk.dim("   ╰ ") + "snapshot-expiration: " + chalk.cyan(display) + "\n",
      );
    } catch (error) {
      spinner.stop();
      throw error;
    }
  },
});

const keepLastCountType = cmd.extendType(cmd.number, {
  displayName: "COUNT",
  async from(n) {
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error(
        `Invalid count: ${n}. Must be an integer between 1 and 10.`,
      );
    }
    return n;
  },
});

const keepLastCommand = cmd.command({
  name: "keep-last",
  description:
    "Update the snapshot retention policy (keep only the N most recent snapshots) of a sandbox",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to update",
    }),
    count: cmd.positional({
      type: cmd.optional(keepLastCountType),
      description:
        "Number of most recent snapshots to keep (1-10). Omit with --clear to remove the policy.",
    }),
    keepLastFor: cmd.option({
      long: "for",
      type: cmd.optional(SnapshotExpiration),
      description:
        'Expiration for kept snapshots. Use "none" or 0 for no expiration. Example: 7d, 30d',
    }),
    softEvict: cmd.flag({
      long: "soft-evict",
      description:
        "Evicted snapshots keep the default expiration instead of being deleted immediately.",
    }),
    clear: cmd.flag({
      long: "clear",
      description:
        "Remove the snapshot retention policy from this sandbox.",
    }),
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandbox: name,
    count,
    keepLastFor,
    softEvict,
    clear,
  }) {
    if (clear && count !== undefined) {
      throw new Error(
        "Cannot combine --clear with a <count> argument. Pass one or the other.",
      );
    }
    if (!clear && count === undefined) {
      throw new Error(
        [
          "Missing <count> argument.",
          `${chalk.bold("hint:")} Pass a count between 1 and 10, or --clear to remove the policy.`,
        ].join("\n"),
      );
    }
    if (clear && (keepLastFor !== undefined || softEvict)) {
      throw new Error(
        "--for and --soft-evict cannot be combined with --clear.",
      );
    }

    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    const spinner = ora("Updating sandbox configuration...").start();
    try {
      if (clear) {
        await sandbox.update({ snapshotKeepLast: null });
      } else {
        await sandbox.update({
          snapshotKeepLast: {
            count: count!,
            expiration:
              keepLastFor !== undefined ? ms(keepLastFor) : undefined,
            deleteEvicted: softEvict ? false : undefined,
          },
        });
      }
      spinner.stop();

      process.stderr.write(
        "✅ Configuration updated for sandbox " + chalk.cyan(name) + "\n",
      );
      if (clear) {
        process.stderr.write(
          chalk.dim("   ╰ ") + "keep-last: " + chalk.cyan("cleared") + "\n",
        );
      } else {
        const parts: string[] = [`count=${count}`];
        if (keepLastFor !== undefined) {
          const displayExp = ms(keepLastFor) === 0 ? "none" : keepLastFor;
          parts.push(`for=${displayExp}`);
        }
        if (softEvict) parts.push("soft-evict");
        process.stderr.write(
          chalk.dim("   ╰ ") +
            "keep-last: " +
            chalk.cyan(parts.join(", ")) +
            "\n",
        );
      }
    } catch (error) {
      spinner.stop();
      throw error;
    }
  },
});

const currentSnapshotCommand = cmd.command({
  name: "current-snapshot",
  description: "Update the current snapshot of a sandbox",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to update",
    }),
    snapshotId: cmd.positional({
      type: snapshotId,
      description: "Snapshot ID to set as the current snapshot",
    }),
    scope,
  },
  async handler({
    scope: { token, team, project },
    sandbox: name,
    snapshotId,
  }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    const spinner = ora("Updating sandbox configuration...").start();
    try {
      await sandbox.update({ currentSnapshotId: snapshotId });
      spinner.stop();

      process.stderr.write(
        "✅ Configuration updated for sandbox " +
          chalk.cyan(name) +
          "\n",
      );
      process.stderr.write(
        chalk.dim("   ╰ ") + "current-snapshot: " + chalk.cyan(snapshotId) + "\n",
      );
    } catch (error) {
      spinner.stop();
      if (
        error instanceof APIError &&
        error.response.status === 404
      ) {
        throw new StyledError(
          `Snapshot '${snapshotId}' was not found or does not belong to this project.`,
          error,
        );
      }
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
    const tagsDisplay = sandbox.tags && Object.keys(sandbox.tags).length > 0
      ? Object.entries(sandbox.tags).map(([k, v]) => `${k}=${v}`).join(", ")
      : "-";
    const rows = [
      { field: "vCPUs", value: String(sandbox.vcpus ?? "-") },
      { field: "Timeout", value: sandbox.timeout != null ? ms(sandbox.timeout, { long: true }) : "-" },
      { field: "Persistent", value: String(sandbox.persistent) },
      { field: "Network policy", value: String(networkPolicy) },
      { field: "Snapshot expiration", value: sandbox.snapshotExpiration != null && sandbox.snapshotExpiration > 0 ? ms(sandbox.snapshotExpiration, { long: true }) : sandbox.snapshotExpiration === 0 ? "none" : "-" },
      { field: "Keep last", value: formatKeepLast(sandbox.snapshotKeepLast) },
      { field: "Current snapshot", value: sandbox.currentSnapshotId ?? "-" },
      { field: "Tags", value: tagsDisplay },
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

const tagsCommand = cmd.command({
  name: "tags",
  description: "Update the tags of a sandbox. Replaces all existing tags with the provided tags.",
  args: {
    sandbox: cmd.positional({
      type: sandboxName,
      description: "Sandbox name to update",
    }),
    tags: cmd.multioption({
      long: "tag",
      short: "t",
      type: ObjectFromKeyValue,
      description: "Key-value tags to set (e.g. --tag env=staging). Omit to clear all tags.",
    }),
    scope,
  },
  async handler({ scope: { token, team, project }, sandbox: name, tags }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
    });

    const tagsObj = Object.keys(tags).length > 0 ? tags : {};

    const spinner = ora("Updating sandbox tags...").start();
    try {
      await sandbox.update({ tags: tagsObj });
      spinner.stop();

      process.stderr.write(
        "✅ Tags updated for sandbox " + chalk.cyan(name) + "\n",
      );
      const entries = Object.entries(tagsObj);
      if (entries.length === 0) {
        process.stderr.write(chalk.dim("   ╰ ") + "all tags cleared\n");
      } else {
        for (let i = 0; i < entries.length; i++) {
          const [k, v] = entries[i];
          const isLast = i === entries.length - 1;
          const prefix = isLast ? chalk.dim("   ╰ ") : chalk.dim("   │ ");
          process.stderr.write(prefix + chalk.cyan(k) + "=" + chalk.cyan(v) + "\n");
        }
      }
    } catch (error) {
      spinner.stop();
      throw error;
    }
  },
});

function formatKeepLast(
  keepLast:
    | { count: number; expiration?: number; deleteEvicted: boolean }
    | undefined,
): string {
  if (!keepLast) return "-";
  const parts = [`count=${keepLast.count}`];
  if (keepLast.expiration !== undefined) {
    parts.push(
      `for=${keepLast.expiration === 0 ? "none" : ms(keepLast.expiration, { long: true })}`,
    );
  }
  if (!keepLast.deleteEvicted) parts.push("soft-evict");
  return parts.join(", ");
}

export const config = cmd.subcommands({
  name: "config",
  description: "View and update sandbox configuration",
  cmds: {
    list: listCommand,
    vcpus: vcpusCommand,
    timeout: timeoutCommand,
    persistent: persistentCommand,
    "network-policy": networkPolicyCommand,
    "snapshot-expiration": snapshotExpirationCommand,
    "keep-last": keepLastCommand,
    "current-snapshot": currentSnapshotCommand,
    tags: tagsCommand,
  },
});
