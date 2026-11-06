import { CliError } from "./cli-error";
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
  displayScope: ReviewScope;
  /** Check for project Bounds only after the proposal is approved. */
  hasProjectBounds?: (scope: ReviewScope) => Promise<boolean>;
  /** Render the exact proposal as a command without executing or approving it. */
  renderCommand?: (config: ManagedCredentialsConfig) => string;
  sandboxName?: string;
  vcpus: number;
  interactive: boolean;
  yes: boolean;
  output?: NodeJS.WritableStream;
  input?: NodeJS.ReadableStream;
}

/**
 * Show one immutable proposal and ask for creation consent.
 *
 * Consent approves the caller's own request; it never returns a replacement.
 * Returning normally means "approved", and every other outcome throws.
 */
export async function runManagedCredentialsFlow(options: {
  initial: ResolvedManagedCredentials;
  context: FlowContext;
}): Promise<void> {
  const { context, initial: resolved } = options;
  const { team, project } = context;
  const write = (text: string) =>
    (context.output ?? process.stderr).write(text);
  const recoveryCommand = () => context.renderCommand?.(resolved.config);
  const showRecoveryCommand = (command: string | undefined) => {
    if (command)
      write(
        `\n  Edit this credentials command and run it again.\n  Re-add other creation options if needed.\n\n${command}\n\n`,
      );
  };
  const cancel = (): never => {
    showRecoveryCommand(recoveryCommand());
    throw new CliError("Sandbox creation canceled.", {
      reason: "canceled",
      exitCode: 130,
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

  if (!context.yes) {
    const rows = buildReview({
      config: resolved.config,
      ...(resolved.actor ? { actor: resolved.actor } : {}),
      team: context.displayScope.team,
      project: context.displayScope.project,
      ...(context.sandboxName ? { sandboxName: context.sandboxName } : {}),
      vcpus: context.vcpus,
    });
    write(
      `\n  Managed credentials for this sandbox:\n\n${renderReview(rows)}\n`,
    );
  }

  if (!context.yes && !context.interactive) {
    showRecoveryCommand(recoveryCommand());
    throw new CliError(
      "Creating this sandbox requests managed access. Review the proposal and pass --yes only after approval.",
      {
        reason: "confirmation_required",
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
    write(`\n  ${message}\n\n`);
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
}
