import { commandMetadata } from "../command-metadata";
import * as cmd from "cmd-ts";
import { isatty } from "node:tty";
import ms from "ms";
import { runtime } from "../args/runtime";
import { timeout } from "../args/timeout";
import { vcpus } from "../args/vcpus";
import chalk from "chalk";
import { createContext } from "../args/create-context";
import { sandboxClient } from "../client";
import { snapshotId } from "../args/snapshot-id";
import { publishPorts } from "../args/ports";
import { snapshotRetentionArgs } from "../args/snapshot-retention";
import ora from "ora";
import { exec } from "./exec";
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
import { CliError } from "../util/cli-error";
import { confirmCreation } from "../util/confirm-creation";
import { APIError } from "@vercel/sandbox";
import { StyledError } from "../error";

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
  scope: createContext(),
} as const;

export const create = cmd.command({
  ...commandMetadata.create,
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
    } = input;
    const { creation, mode } = scope;
    const authScope = {
      token: scope.token,
      team: scope.team,
      project: scope.project,
      ...(scope.teamSlug ? { teamSlug: scope.teamSlug } : {}),
      ...(scope.projectSlug ? { projectSlug: scope.projectSlug } : {}),
    };
    let creationAttempted = false;
    let createdName: string | undefined;
    try {
      // Internal flag for composing commands (e.g. `run`) that create a sandbox
      // as a step rather than as the outcome, where a connect hint would mislead.
      const { __printConnectHint = true } = input as {
        __printConnectHint?: boolean;
      };
      const launcher = agent ? agents[agent] : undefined;
      if (snapshot !== undefined && creation.source !== undefined) {
        throw new CliError(
          "--snapshot cannot be combined with --git-source or source in --file.",
        );
      }
      const source =
        creation.source ??
        (snapshot
          ? { type: "snapshot" as const, snapshotId: snapshot }
          : undefined);
      if (
        source?.type === "snapshot" &&
        !agent &&
        (runtime !== undefined || image !== undefined)
      ) {
        throw new CliError(
          "A snapshot source cannot be combined with --runtime, --image, or an agent shortcut.",
        );
      }
      if (mode.json && (silent || connect || agent)) {
        throw new CliError(
          "--json cannot be combined with --silent, --connect, or an agent shortcut.",
        );
      }
      if (!mode.interactive && (connect || agent) && scope.creationRequested) {
        throw new CliError(
          "Connecting after creation requires an interactive terminal. Remove --connect or the agent shortcut, then connect separately.",
        );
      }
      if (agent) {
        if (
          runtime !== undefined ||
          image !== undefined ||
          snapshot !== undefined ||
          source?.type === "snapshot"
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
      const versionCheck =
        silent || mode.json ? undefined : startLatestVersionCheck();

      const networkPolicy = buildNetworkPolicy(input) ?? "allow-all";

      const keepLastSnapshotsPayload = buildKeepLastSnapshotsPayload({
        keepLastSnapshots,
        keepLastSnapshotsFor,
        deleteEvictedSnapshots,
      });

      const selectedImage = agent ? "vercel/sandbox/universal" : image;
      const runtimeOptions =
        selectedImage !== undefined
          ? { image: selectedImage }
          : runtime !== undefined
            ? { runtime }
            : {};

      const persistent = !nonPersistent;
      const resources = vcpus ? { vcpus } : undefined;
      const tagsObj = Object.keys(tags).length > 0 ? tags : undefined;
      const mountsObj = Object.keys(mounts).length > 0 ? mounts : undefined;
      await confirmCreation(scope, name);
      const spinner =
        silent || !mode.interactive
          ? undefined
          : ora("Creating sandbox...").start();
      const sourceOptions =
        source?.type === "snapshot"
          ? { source }
          : { ...runtimeOptions, source };
      let sandbox;
      try {
        creationAttempted = true;
        sandbox = await sandboxClient.create({
          name,
          teamId: scope.team,
          projectId: scope.project,
          token: scope.token,
          ports,
          ...sourceOptions,
          commitAs: creation.commitAs,
          credentials: creation.credentials,
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
        createdName = sandbox.name;
      } finally {
        spinner?.stop();
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

      if (mode.json) {
        const session = sandbox.currentSession();
        const selector = (value: string, placeholder: string) =>
          /^[A-Za-z0-9_.-]+$/.test(value) ? value : placeholder;
        const argv = [
          ...(scope.appName === "vercel sandbox"
            ? ["vercel", "sandbox"]
            : ["sandbox"]),
          "config",
          "list",
          selector(sandbox.name, "<SANDBOX>"),
          "--scope",
          selector(scope.team, "<TEAM>"),
          "--project",
          selector(scope.project, "<PROJECT>"),
        ];
        process.stdout.write(
          JSON.stringify({
            sandbox: { name: sandbox.name },
            session: { id: session.sessionId, status: session.status },
            outcome: "created",
            next: [
              {
                command: argv.join(" "),
                argv,
              },
            ],
          }) + "\n",
        );
      } else if (!silent) {
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
          await exec.handler({
            ...(launcher
              ? { command: launcher.command, args: launcher.args }
              : defaultShell),
            scope: authScope,
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
    } catch (error) {
      if (error instanceof CliError)
        throw new CliError(error.message, {
          ...error.options,
          json: mode.json,
        });
      if (mode.json || scope.creationRequested) {
        const apiError =
          error instanceof APIError
            ? error
            : error instanceof StyledError && error.cause instanceof APIError
              ? error.cause
              : undefined;
        const rejected =
          apiError !== undefined && apiError.response.status < 500;
        const unknownOutcome = creationAttempted && !createdName && !rejected;
        throw new CliError(
          createdName
            ? "The sandbox was created, but the local follow-up failed. Inspect the sandbox before retrying."
            : unknownOutcome
              ? "Can't confirm whether the sandbox was created. Inspect the sandbox list before retrying."
              : "Sandbox creation was rejected. Check project access and managed credential availability before retrying.",
          {
            reason: createdName
              ? "post_creation_failed"
              : unknownOutcome
                ? "unknown_outcome"
                : "creation_failed",
            exitCode: 1,
            json: mode.json,
            data: {
              sandbox: { name: createdName ?? name ?? null },
              ...(apiError ? { status: apiError.response.status } : {}),
            },
          },
        );
      }
      throw error;
    }
  },
});
