import type { CreateContext } from "../args/create-context";
import { CliError } from "./cli-error";
import type { ManagedCredentialsConfig } from "./managed-credentials-config";
import { runManagedCredentialsFlow } from "./managed-credentials-flow";
import {
  persistConfiguration,
  resolvePersistPath,
} from "./managed-credentials-persist";
import { renderManagedCredentialsRetryCommand } from "./managed-credentials-retry-command";
import { hasProjectBounds } from "./managed-credentials-project-bounds";
import { resolveScopeDisplay } from "./scope-display";
import { createVercelApi } from "./vercel-api";

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
  /**
   * The approved request.
   *
   * The canonical configuration already uses the Sandbox creation API shape,
   * so creation, persistence and the dry-run report all read this one object.
   */
  config: ManagedCredentialsConfig;
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
  if (!context.managed) return undefined;

  const vcpus = options.vcpus ?? MANAGED_CREDENTIALS_VCPUS;
  const api = createVercelApi({ token: context.token });
  // Labels for the review table only. The selected IDs below stay the sole
  // authority for policy reads and for the API, and the token never changes.
  // A --yes run never shows the table, so skip both metadata GETs.
  const displayScope =
    context.mode.json || context.yes
      ? {
          team: context.teamSlug ?? context.team,
          project: context.projectSlug ?? context.project,
        }
      : await resolveScopeDisplay({
          token: context.token,
          team: context.team,
          project: context.project,
          teamSlug: context.teamSlug,
          projectSlug: context.projectSlug,
          api,
        });

  await runManagedCredentialsFlow({
    initial: context.managed,
    context: {
      team: context.team,
      project: context.project,
      displayScope,
      ...(context.scopeProvenance
        ? { scopeProvenance: context.scopeProvenance }
        : {}),
      ...(options.sandboxName ? { sandboxName: options.sandboxName } : {}),
      vcpus,
      vcpusExplicit: options.vcpus !== undefined,
      interactive: context.mode.interactive,
      json: context.mode.json,
      yes: context.yes,
      dryRun: context.dryRun,
      hasProjectBounds: async ({ team, project }) => {
        try {
          return await hasProjectBounds({
            token: context.token,
            team,
            project,
            api,
          });
        } catch (error) {
          if (error instanceof CliError) {
            throw new CliError(error.message, {
              ...error.options,
              json: context.mode.json,
            });
          }
          throw error;
        }
      },
      // Recovery keeps the selector spelling the user typed, not the review
      // labels: a slug the user supplied, otherwise the selected ID.
      renderCommand: (config) =>
        renderManagedCredentialsRetryCommand({
          config,
          team: context.teamSlug ?? context.team,
          project: context.projectSlug ?? context.project,
          vcpus,
          invocation: context.retryInvocation ?? {
            appName: context.appName ?? "sandbox",
            command: "create",
            args: options.sandboxName
              ? [
                  {
                    kind: "option",
                    dash: "--",
                    keys: "name",
                    value: options.sandboxName,
                    inline: true,
                  },
                ]
              : [],
          },
        }),
    },
  });

  return { config: context.managed.config, vcpus };
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
    path = resolvePersistPath({ requested });
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
