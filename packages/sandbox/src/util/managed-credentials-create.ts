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
   * The configuration uses the Sandbox creation API shape, so creation and
   * persistence read this one object.
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
  vcpus?: number;
}): Promise<PreparedManagedCredentials | undefined> {
  const { context } = options;
  if (!context.managed) return undefined;

  const vcpus = options.vcpus ?? MANAGED_CREDENTIALS_VCPUS;
  const api = createVercelApi({ token: context.token });
  // Labels for the review table only. The selected IDs below stay the sole
  // authority for policy reads and for the API, and the token never changes.
  // A --yes run never shows the table, so skip both metadata GETs.
  const displayScope = context.yes
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
      interactive: context.interactive,
      yes: context.yes,
      hasProjectBounds: ({ team, project }) =>
        hasProjectBounds({ token: context.token, team, project, api }),
      // Recovery keeps the selector spelling the user typed, not the review
      // labels: a slug the user supplied, otherwise the selected ID.
      renderCommand: (config) =>
        renderManagedCredentialsRetryCommand({
          config,
          ...(context.managed?.actor ? { actor: context.managed.actor } : {}),
          team: context.teamSlug ?? context.team,
          project: context.projectSlug ?? context.project,
          vcpus,
          hasExplicitToken: context.hasExplicitToken,
          appName: context.appName,
        }),
    },
  });

  return { config: context.managed.config, vcpus };
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
  sandboxName: string;
  silent?: boolean;
}): Promise<void> {
  const requested = options.context.persistConfiguration;
  if (requested === undefined) return;

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
      },
    );
  }

  if (!options.silent) {
    process.stderr.write(`   ╰ Configuration saved to ${path}\n`);
  }
}
