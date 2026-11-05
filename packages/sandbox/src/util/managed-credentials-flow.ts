import { CliError } from "./cli-error";
import type { ScopeProvenance } from "./infer-scope";
import {
  type BoundsLookup,
  type MissingBound,
  calculateMissingBounds,
} from "./managed-credentials-bounds";
import type { ManagedCredentialsConfig } from "./managed-credentials-config";
import type { ResolvedManagedCredentials } from "./managed-credentials-resolve";
import {
  buildReview,
  promptReviewDecision,
  question,
  renderReview,
} from "./managed-credentials-review";

export interface ReviewScope {
  team: string;
  project: string;
}

export interface FlowContext extends ReviewScope {
  /** Review labels only, never policy/API/recovery selectors. */
  displayScope?: ReviewScope;
  /** Optional read-only coverage calculation. */
  readBounds?: (scope: ReviewScope) => Promise<BoundsLookup | undefined>;
  /** Check for project Bounds only after the proposal is approved. */
  hasProjectBounds?: (scope: ReviewScope) => Promise<boolean>;
  /** Render the exact proposal as a command without executing or approving it. */
  renderCommand?: (
    proposal: ReviewScope & { config: ManagedCredentialsConfig },
  ) => string;
  scopeProvenance?: ScopeProvenance;
  sandboxName?: string;
  vcpus: number;
  vcpusExplicit: boolean;
  interactive: boolean;
  json: boolean;
  yes: boolean;
  dryRun: boolean;
  output?: NodeJS.WritableStream;
  input?: NodeJS.ReadableStream;
}

export interface FlowResult extends ReviewScope {
  config: ManagedCredentialsConfig;
  missingBounds: MissingBound[];
  boundsApproved: boolean;
}

/** Show one immutable proposal and ask for creation consent. */
export async function runManagedCredentialsFlow(options: {
  initial: ResolvedManagedCredentials;
  context: FlowContext;
}): Promise<FlowResult> {
  const { context, initial: resolved } = options;
  const { team, project } = context;
  const write = (text: string) =>
    (context.output ?? process.stderr).write(text);
  const recoveryCommand = () =>
    context.renderCommand?.({ config: resolved.config, team, project });
  const showRecoveryCommand = (command: string | undefined) => {
    if (command && !context.json)
      write(`\n  Edit this command and run it again:\n\n${command}\n\n`);
  };
  const cancel = (): never => {
    const command = recoveryCommand();
    showRecoveryCommand(command);
    throw new CliError("Sandbox creation canceled.", {
      reason: "canceled",
      exitCode: 130,
      json: context.json,
      ...(command ? { data: { command } } : {}),
    });
  };
  const withCancellation = async <T>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CliError && error.options.reason === "canceled")
        cancel();
      throw error;
    }
  };

  const missingBounds = await resolveBounds(
    context,
    { team, project },
    resolved.config,
  );
  const rows = buildReview({
    config: resolved.config,
    originLabel: resolved.originLabel,
    provenance: {
      ...resolved.provenance,
      team: context.scopeProvenance?.team ?? "provided scope",
      project: context.scopeProvenance?.project ?? "provided scope",
    },
    ...(resolved.actor ? { actor: resolved.actor } : {}),
    team: context.displayScope?.team ?? team,
    project: context.displayScope?.project ?? project,
    ...(context.sandboxName ? { sandboxName: context.sandboxName } : {}),
    vcpus: context.vcpus,
    vcpusExplicit: context.vcpusExplicit,
    missingBounds,
  });
  if (!context.json) {
    if (!context.yes) {
      write(
        `\n  Managed credentials for this sandbox:\n\n${renderReview(rows)}\n`,
      );
    }
    if (missingBounds.length)
      write(
        context.yes
          ? "  Approving also raises the project-wide ceiling for every member of the project.\n\n"
          : "  Approving also raises the project-wide ceiling shown above for every member of the project.\n\n",
      );
  }

  if (context.dryRun)
    return {
      config: resolved.config,
      team,
      project,
      missingBounds,
      boundsApproved: false,
    };

  if (!context.yes && !context.interactive) {
    const command = recoveryCommand();
    showRecoveryCommand(command);
    throw new CliError(
      missingBounds.length
        ? "Creating this sandbox requests managed access and would raise the project-wide ceiling. Review the proposal and pass --yes only after approval."
        : "Creating this sandbox requests managed access. Review the proposal and pass --yes only after approval.",
      {
        reason: "confirmation_required",
        json: context.json,
        userActionRequired: true,
        data: {
          team,
          project,
          effects: rows.map((row) => `${row.label}: ${row.value}`),
          ...(command ? { command } : {}),
          ...(missingBounds.length ? { policyAdditions: missingBounds } : {}),
        },
      },
    );
  }

  if (!context.yes) {
    const decision = await withCancellation(() =>
      promptReviewDecision({
        ...(context.input ? { input: context.input } : {}),
        ...(context.output ? { output: context.output } : {}),
      }),
    );
    if (decision.action === "cancel") cancel();
  }

  if (
    context.hasProjectBounds &&
    !(await context.hasProjectBounds({ team, project }))
  ) {
    const message =
      "This project has no Bounds. There is no project-wide limit on managed-credential access. " +
      (context.yes
        ? "The Sandbox still receives only the requested rights."
        : "The Sandbox still receives only the rights shown above.");
    if (context.json)
      write(
        `${JSON.stringify({ status: "warning", reason: "project_has_no_bounds", message, team, project })}\n`,
      );
    else write(`\n  ${message}\n\n`);
    // --yes accepts both confirmations, but never suppresses the warning.
    if (!context.yes) {
      const answer = await withCancellation(() =>
        question("Continue without project Bounds? (y/N) ", {
          ...(context.input ? { input: context.input } : {}),
          ...(context.output ? { output: context.output } : {}),
        }),
      );
      if (!/^(y|yes)$/i.test(answer.trim())) cancel();
    }
  }
  return {
    config: resolved.config,
    team,
    project,
    missingBounds,
    boundsApproved: missingBounds.length > 0,
  };
}

async function resolveBounds(
  context: FlowContext,
  scope: ReviewScope,
  config: ManagedCredentialsConfig,
): Promise<MissingBound[]> {
  if (!context.readBounds) return [];
  const lookup = await context.readBounds(scope);
  // An absent policy source is not an empty policy. The server enforces it.
  return lookup ? calculateMissingBounds(config, lookup) : [];
}
