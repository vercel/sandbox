import { CliError } from "./cli-error";
import type { ScopeProvenance } from "./infer-scope";
import {
  type BoundsLookup,
  type MissingBound,
  calculateMissingBounds,
} from "./managed-credentials-bounds";
import type { ManagedCredentialsConfig } from "./managed-credentials-config";
import {
  EDITABLE_FIELDS,
  type EditableField,
  type ManagedCredentialsOptions,
  type ResolvedManagedCredentials,
  invalidatedBy,
} from "./managed-credentials-resolve";
import {
  buildReview,
  promptReviewDecision,
  question,
  renderReview,
  type ReviewDecision,
} from "./managed-credentials-review";

/**
 * Scope values the review can correct.
 *
 * Kept separate from the configuration because they are resolved by the
 * existing scope machinery rather than by managed-credential inference.
 */
export interface ScopeOverrides {
  team?: string;
  project?: string;
}

export interface FlowContext {
  /** Re-run inference with the given overrides applied. */
  reresolve: (
    options: ManagedCredentialsOptions,
    scope: ScopeOverrides,
  ) => Promise<ResolvedManagedCredentials>;
  /** Re-read the policy ceiling for the current team/project. */
  readBounds?: (
    scope: Required<ScopeOverrides>,
  ) => Promise<BoundsLookup | undefined>;
  /** Check only for project Bounds, after the proposal has been approved. */
  hasProjectBounds?: (scope: Required<ScopeOverrides>) => Promise<boolean>;
  /** Render the latest proposal as an editable command, without performing it. */
  renderCommand?: (proposal: {
    config: ManagedCredentialsConfig;
    team: string;
    project: string;
  }) => string;
  team: string;
  project: string;
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

export interface FlowResult {
  config: ManagedCredentialsConfig;
  /** Team shown in the approved review, for display. */
  team: string;
  /** Project shown in the approved review, for display. */
  project: string;
  /**
   * Scope the user corrected during review, if any.
   *
   * The caller must create in this scope rather than the one it started with:
   * an approval refers to the team and project the review displayed.
   */
  scopeOverrides: ScopeOverrides;
  missingBounds: MissingBound[];
  /** True when the user explicitly approved project-wide policy additions. */
  boundsApproved: boolean;
}

/**
 * Present one complete proposal, accept corrections, and get approval,
 * including a second confirmation when the project has no Bounds.
 *
 * Inference has already run, so the user sees a finished configuration rather
 * than a sequence of per-field confirmations. Editing any value re-runs the
 * inference that depends on it and recomputes the permission check before the
 * proposal can be approved, so an approval always refers to what will actually
 * be created.
 */
export async function runManagedCredentialsFlow(options: {
  initial: ResolvedManagedCredentials;
  managedOptions: ManagedCredentialsOptions;
  context: FlowContext;
}): Promise<FlowResult> {
  const { context } = options;
  const write = (text: string) =>
    (context.output ?? process.stderr).write(text);

  let resolved = options.initial;
  let overrides: ManagedCredentialsOptions = { ...options.managedOptions };
  let scope: ScopeOverrides = {};
  let team = context.team;
  let project = context.project;
  const edited = new Set<EditableField>();
  let preservedPresetGitAccess = false;

  const recoveryCommand = () =>
    scope.team !== undefined && scope.project === undefined
      ? undefined
      : context.renderCommand?.({ config: resolved.config, team, project });
  const showRecoveryCommand = (command: string | undefined) => {
    if (command && !context.json) {
      write(`\n  Edit this command and run it again:\n\n${command}\n\n`);
    }
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
      if (error instanceof CliError && error.options.reason === "canceled") {
        cancel();
      }
      throw error;
    }
  };

  const confirmProjectBounds = async () => {
    if (!context.hasProjectBounds) return;
    if (await context.hasProjectBounds({ team, project })) return;

    const message =
      "This project has no Bounds. There is no project-wide limit on managed-credential access. The Sandbox still receives only the rights shown above.";
    if (context.json) {
      write(
        `${JSON.stringify({
          status: "warning",
          reason: "project_has_no_bounds",
          message,
          team,
          project,
        })}\n`,
      );
    } else {
      write(`\n  ${message}\n\n`);
    }

    // `--yes` accepts both confirmations, but never suppresses the warning.
    if (context.yes) return;
    const answer = await withCancellation(() =>
      question("Continue without project Bounds? (y/N) ", {
        ...(context.input ? { input: context.input } : {}),
        ...(context.output ? { output: context.output } : {}),
      }),
    );
    if (!/^(y|yes)$/i.test(answer.trim())) cancel();
  };

  for (;;) {
    const missingBounds =
      scope.team !== undefined && scope.project === undefined
        ? []
        : await resolveBounds(context, { team, project }, resolved.config);

    const rows = buildReview({
      config: resolved.config,
      originLabel: resolved.originLabel,
      provenance: {
        ...resolved.provenance,
        ...(preservedPresetGitAccess
          ? { gitAccess: "github-access" as const }
          : {}),
        team:
          scope.team !== undefined
            ? "edited during review"
            : (context.scopeProvenance?.team ?? "provided scope"),
        project:
          scope.project !== undefined
            ? "edited during review"
            : scope.team !== undefined
              ? "not selected for the edited team"
              : (context.scopeProvenance?.project ?? "provided scope"),
      },
      ...(resolved.actor ? { actor: resolved.actor } : {}),
      edited: [...edited],
      team,
      project,
      ...(context.sandboxName ? { sandboxName: context.sandboxName } : {}),
      vcpus: context.vcpus,
      vcpusExplicit: context.vcpusExplicit,
      missingBounds,
    });

    if (!context.json) {
      write(
        `\n  Managed credentials for this sandbox:\n\n${renderReview(rows)}\n`,
      );
      if (missingBounds.length > 0) {
        write(
          "  Approving also raises the project-wide ceiling shown above for every member of the project.\n\n",
        );
      }
    }

    // A dry run stops here: it must not create a Sandbox, change policy, or
    // write files, so there is nothing left to approve.
    if (context.dryRun) {
      return {
        config: resolved.config,
        team,
        project,
        scopeOverrides: scope,
        missingBounds,
        boundsApproved: false,
      };
    }

    // `--yes` is approval, including for the clearly displayed policy
    // additions. It never supplies a missing input.
    if (context.yes) {
      await confirmProjectBounds();
      return {
        config: resolved.config,
        team,
        project,
        scopeOverrides: scope,
        missingBounds,
        boundsApproved: missingBounds.length > 0,
      };
    }

    if (!context.interactive) {
      const command = recoveryCommand();
      showRecoveryCommand(command);
      throw new CliError(
        missingBounds.length > 0
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
            ...(missingBounds.length > 0
              ? { policyAdditions: missingBounds }
              : {}),
          },
        },
      );
    }

    // A file or a copied Sandbox states the access it wants, and the direct
    // flags cannot be combined with it. Offering those edits would build an
    // input combination that is rejected outright, so only the scope is
    // correctable for those origins.
    const editable: readonly EditableField[] =
      resolved.origin === "flags"
        ? EDITABLE_FIELDS
        : (["team", "project"] as const);

    const decision: ReviewDecision = await withCancellation(() =>
      promptReviewDecision({
        editable,
        ...(context.input ? { input: context.input } : {}),
        ...(context.output ? { output: context.output } : {}),
      }),
    );

    // Rejection reports the proposal, but never approves or performs it.
    if (decision.action === "cancel") return cancel();

    if (decision.action === "create") {
      if (scope.team !== undefined && scope.project === undefined) {
        // The old team's project was discarded and no replacement was given,
        // so there is no project to create in.
        write("  Set a project for the corrected team before creating.\n");
        continue;
      }
      await confirmProjectBounds();
      return {
        config: resolved.config,
        team,
        project,
        scopeOverrides: scope,
        missingBounds,
        boundsApproved: missingBounds.length > 0,
      };
    }

    const applied = await withCancellation(() =>
      applyEdit({
        field: decision.field,
        overrides,
        scope,
        write,
        ...(context.input ? { input: context.input } : {}),
        ...(context.output ? { output: context.output } : {}),
      }),
    );
    if (!applied) continue;
    if (decision.field === "actions" && overrides.githubAccess !== undefined)
      preservedPresetGitAccess = true;
    edited.add(decision.field);
    if (decision.field === "team") edited.delete("project");
    ({ overrides, scope } = applied);
    team = scope.team ?? context.team;
    // After a team correction the previous project is gone rather than
    // inherited: a project linked for the old team must not survive the
    // override, and silently pairing a new team with it would show — and
    // create — a combination the user never chose.
    project =
      scope.project ??
      (scope.team !== undefined ? "(not set)" : context.project);

    // Recompute from the corrected inputs rather than patching the previous
    // proposal, so dependent inference and the permission check are redone.
    if (scope.team === undefined || scope.project !== undefined) {
      resolved = await context.reresolve(overrides, scope);
    }
  }
}

async function resolveBounds(
  context: FlowContext,
  scope: Required<ScopeOverrides>,
  config: ManagedCredentialsConfig,
): Promise<MissingBound[]> {
  if (!context.readBounds) return [];
  const lookup = await context.readBounds(scope);
  // No policy source to read is not the same as an empty policy: propose
  // nothing and let the server enforce the ceiling.
  if (!lookup) return [];
  return calculateMissingBounds(config, lookup);
}

/**
 * Prompt for a corrected value and invalidate what depended on the old one.
 *
 * Returns `undefined` when the user supplied nothing, leaving the proposal
 * untouched.
 */
async function applyEdit(options: {
  field: EditableField;
  overrides: ManagedCredentialsOptions;
  scope: ScopeOverrides;
  write: (text: string) => unknown;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): Promise<
  { overrides: ManagedCredentialsOptions; scope: ScopeOverrides } | undefined
> {
  const prompts: Record<EditableField, string> = {
    team: "  Team (slug or team_* ID): ",
    project: "  Project (slug or prj_* ID): ",
    repository: "  Repository (OWNER/REPOSITORY): ",
    actions:
      "  GitHub API actions (comma-separated, e.g. issues:read,pull-request:create): ",
    commitAs: '  Commit credit ("Name <email>"): ',
    actAs: "  GitHub API actor (username or numeric user ID): ",
  };

  const io = {
    ...(options.input ? { input: options.input } : {}),
    ...(options.output ? { output: options.output } : {}),
  };
  const answer = (await question(prompts[options.field], io)).trim();
  if (!answer) return undefined;

  const overrides: ManagedCredentialsOptions = { ...options.overrides };
  const scope: ScopeOverrides = { ...options.scope };

  switch (options.field) {
    case "team":
      scope.team = answer;
      // A project linked from local configuration belongs to the old team, so
      // it must not survive a team override. Ask for the replacement straight
      // away rather than leaving the proposal in a half-set state.
      delete scope.project;
      {
        const project = (await question(prompts.project, io)).trim();
        if (project) scope.project = project;
      }
      break;
    case "project":
      scope.project = answer;
      break;
    case "repository":
      overrides.credentialsRepo = answer;
      break;
    case "actions": {
      const actions = answer
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (actions.length === 0) {
        // An empty list would read as "no override" and quietly restore the
        // default action set, widening what the user was narrowing.
        options.write(
          "  Enter at least one action, or cancel to keep the current set.\n",
        );
        return undefined;
      }
      if (overrides.githubAccess !== undefined) {
        // Replace the API preset without restoring the default Git write access.
        overrides.credentialsNoWrite = overrides.githubAccess === "read";
        delete overrides.githubAccess;
      }
      overrides.credentialsActions = actions;
      break;
    }
    case "commitAs":
      overrides.credentialsCommitAs = answer;
      break;
    case "actAs":
      overrides.credentialsActAs = answer;
      break;
  }

  // Dependent values are not patched here. The caller re-resolves from these
  // corrected inputs, and anything the user has not overridden explicitly is
  // inferred again from scratch — so an inference made for the old value is
  // recomputed rather than carried over. Values the user did set explicitly
  // are left alone, because an explicit value outranks an inferred one.
  const invalidated = invalidatedBy(options.field);
  if (invalidated.length > 0) {
    options.write(
      `  Re-checking ${invalidated.join(", ")} and permissions for the new ${options.field}.\n`,
    );
  }

  return { overrides, scope };
}
