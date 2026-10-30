import type { CreateContext } from "../args/create-context";
import { CliError } from "./cli-error";
import type { ManagedCredentialsConfig } from "./managed-credentials-config";
import { runManagedCredentialsFlow } from "./managed-credentials-flow";
import {
  persistConfiguration,
  resolvePersistPath,
} from "./managed-credentials-persist";
import {
  resolveManagedCredentials,
  type ManagedCredentialsOptions,
} from "./managed-credentials-resolve";
import { loadConfigFromSandbox } from "./managed-credentials-reuse";
import { fetchSandboxCredentialSnapshot } from "./managed-credentials-client";
import {
  toTransport,
  type ManagedCredentialsTransport,
} from "./managed-credentials-transport";

/**
 * vCPU allocation for managed-credentials creations.
 *
 * Six vCPUs is a deliberate workaround, not a performance choice: this size
 * does not come from the warm pool, and managed Git initialization currently
 * fails on warm-pool instances. A default-capacity creation
 * (`sandbox-2cpu-4gb`) failed to clone a private repository with "could not
 * read Username", while the same image at six vCPUs cloned that repository
 * successfully with a read-only Git Grant. An explicit `--vcpus` takes
 * precedence, and ordinary creation defaults are unchanged.
 *
 * Remove this once warm-pool instances initialize managed Git correctly.
 */
export const MANAGED_CREDENTIALS_VCPUS = 6;

export interface PreparedManagedCredentials {
  /** The approved request, in transport terms. */
  transport: ManagedCredentialsTransport;
  /** The approved logical configuration, for persistence. */
  config: ManagedCredentialsConfig;
  /**
   * Team the review displayed, when the user corrected it.
   *
   * Creation must use this rather than the originally resolved scope, so the
   * sandbox lands in the team the approval referred to.
   */
  teamOverride?: string;
  /** Project the review displayed, when the user corrected it. */
  projectOverride?: string;
  vcpus: number;
}

/**
 * Review and approve the managed-credentials proposal before creation.
 *
 * Returns `undefined` when this invocation did not request managed
 * credentials, leaving a bare `create` untouched.
 */
export async function prepareManagedCredentials(options: {
  context: CreateContext;
  sandboxName?: string;
  vcpus?: number;
}): Promise<PreparedManagedCredentials | undefined> {
  const { context } = options;
  if (!context.managed || !context.managedOptions) return undefined;

  const vcpus = options.vcpus ?? MANAGED_CREDENTIALS_VCPUS;

  const result = await runManagedCredentialsFlow({
    initial: context.managed,
    managedOptions: context.managedOptions,
    context: {
      team: context.teamSlug ?? context.team,
      project: context.projectSlug ?? context.project,
      ...(options.sandboxName ? { sandboxName: options.sandboxName } : {}),
      vcpus,
      vcpusExplicit: options.vcpus !== undefined,
      interactive: context.mode.interactive,
      json: context.mode.json,
      yes: context.yes,
      dryRun: context.dryRun,
      reresolve: (overrides: ManagedCredentialsOptions, scope) =>
        reresolve({ context, overrides, scope }),
    },
  });

  return {
    transport: toTransport(result.config),
    config: result.config,
    ...(result.scopeOverrides.team !== undefined
      ? { teamOverride: result.scopeOverrides.team }
      : {}),
    ...(result.scopeOverrides.project !== undefined
      ? { projectOverride: result.scopeOverrides.project }
      : {}),
    vcpus,
  };
}

/**
 * Re-run inference after a review correction.
 *
 * The whole proposal is rebuilt from the corrected inputs, so inference that
 * depended on an edited value is redone rather than carried over.
 */
async function reresolve(options: {
  context: CreateContext;
  overrides: ManagedCredentialsOptions;
  scope: { team?: string; project?: string };
}) {
  const team = options.scope.team ?? options.context.team;
  const project = options.scope.project ?? options.context.project;
  const resolved = await resolveManagedCredentials(options.overrides, {
    token: options.context.token,
    teamId: team,
    loadFromSandbox: (selector) =>
      loadConfigFromSandbox({
        selector,
        fetchSnapshot: (params) =>
          fetchSandboxCredentialSnapshot({
            ...params,
            token: options.context.token,
            teamId: team,
            projectId: project,
          }),
      }),
  });
  if (!resolved) {
    throw new CliError(
      "The corrected values no longer request managed credentials.",
    );
  }
  return resolved;
}

/** Print the dry-run outcome and exit without creating anything. */
export function reportDryRun(options: {
  context: CreateContext;
  prepared?: PreparedManagedCredentials;
}): void {
  const { context, prepared } = options;
  if (context.mode.json) {
    process.stdout.write(
      JSON.stringify({
        outcome: "dry_run",
        sandbox: null,
        ...(prepared
          ? {
              managedCredentials: prepared.config,
              resources: { vcpus: prepared.vcpus },
            }
          : {}),
      }) + "\n",
    );
    return;
  }
  process.stderr.write(
    "  Dry run: no sandbox was created, no policy was changed, and no files were written.\n",
  );
}

/**
 * Write the approved configuration after a successful creation.
 *
 * Any failure here is local: the Sandbox already exists, so the error names it
 * and the caller never creates another Sandbox to retry a file write.
 */
export async function persistManagedConfiguration(options: {
  context: CreateContext;
  config: ManagedCredentialsConfig;
  sandboxId: string;
  sandboxName: string;
  silent?: boolean;
}): Promise<string | undefined> {
  const requested = options.context.persistConfiguration;
  if (requested === undefined) return undefined;

  let path: string;
  try {
    path = resolvePersistPath({
      requested,
      sandboxId: options.sandboxId,
    });
    await persistConfiguration({ config: options.config, path });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `The sandbox ${options.sandboxName} was created, but its configuration could not be saved. ${detail}`,
      {
        reason: "persist_failed",
        exitCode: 1,
        json: options.context.mode.json,
        data: {
          sandbox: { name: options.sandboxName, id: options.sandboxId },
          outcome: "created_without_configuration_file",
        },
      },
    );
  }

  if (!options.silent && !options.context.mode.json) {
    process.stderr.write(`   ╰ Configuration saved to ${path}\n`);
  }
  return path;
}
