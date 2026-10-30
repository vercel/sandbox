import { createInterface } from "node:readline";
import { CliError } from "./cli-error";
import {
  type ManagedCredentialsConfig,
  gitAccessFor,
  hasInertCommitAs,
  isApiAction,
} from "./managed-credentials-config";
import {
  describeMissingBounds,
  type MissingBound,
} from "./managed-credentials-bounds";
import type {
  ConfigProvenance,
  EditableField,
} from "./managed-credentials-resolve";
import { EDITABLE_FIELDS } from "./managed-credentials-resolve";

/** Strip control and bidirectional characters before display. */
export const safeText = (text: string) =>
  text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, "");

export interface ReviewInput {
  config: ManagedCredentialsConfig;
  originLabel: string;
  provenance: ConfigProvenance;
  team: string;
  project: string;
  sandboxName?: string;
  vcpus: number;
  vcpusExplicit: boolean;
  missingBounds: readonly MissingBound[];
}

export interface ReviewRow {
  label: string;
  value: string;
  /** Why this value was chosen, shown dimmed beside the value. */
  note?: string;
}

/**
 * Build the review model.
 *
 * Pure so the exact contents can be asserted in tests without driving a
 * terminal. Commit credit and the API actor are deliberately separate rows:
 * Git `user.name`/`user.email` are metadata, not proof of GitHub identity or
 * permission, and showing them as one field would imply otherwise.
 */
export function buildReview(input: ReviewInput): ReviewRow[] {
  const { config } = input;
  const rows: ReviewRow[] = [];

  rows.push({ label: "Team", value: safeText(input.team) });
  rows.push({ label: "Project", value: safeText(input.project) });
  rows.push({
    label: "Sandbox",
    value: input.sandboxName
      ? safeText(input.sandboxName)
      : "new sandbox (name assigned by the server)",
  });

  rows.push({
    label: "Source",
    value: config.source
      ? safeText(config.source.repo)
      : "none (no repository cloned)",
    ...(config.source && input.provenance.repository === "git-remote"
      ? { note: "inferred from the local Git remote" }
      : config.source && input.provenance.repository === "explicit"
        ? { note: "from --credentials-repo" }
        : {}),
  });

  if (config.source?.revision) {
    rows.push({ label: "Revision", value: safeText(config.source.revision) });
  }

  // Per-repository access, so a multi-repository configuration shows its
  // mapping rather than a merged union of permissions.
  for (const group of config.credentials.github) {
    const api = group.actions.filter(isApiAction);
    rows.push({
      label: `Access ${safeText(group.repo)}`,
      value: api.length > 0 ? api.join(", ") : "no GitHub API actions",
      ...(api.length === 0
        ? { note: "explicitly empty; defaults are not added" }
        : {}),
    });
  }

  const sourceGit = config.source
    ? gitAccessFor(config, config.source.repo)
    : undefined;
  // Only describe where Git access came from when it was inferred from the
  // flags; a configuration file states it directly.
  const inferredGit = input.provenance.repository !== "config";
  rows.push({
    label: "Git access",
    value: sourceGit ?? "none",
    ...(sourceGit === "git:write"
      ? {
          note: inferredGit
            ? "default for a managed source; clone, fetch, pull, and push"
            : "clone, fetch, pull, and push",
        }
      : sourceGit === "git:read"
        ? {
            note: inferredGit
              ? "read-only clone, from --credentials-no-write"
              : "read-only clone",
          }
        : {}),
  });

  rows.push({
    label: "Commit credit",
    value: config.commitAs
      ? `${safeText(config.commitAs.name)} <${safeText(config.commitAs.email)}>`
      : "none",
    ...(hasInertCommitAs(config)
      ? { note: "no effect without Git write access" }
      : input.provenance.commitAs === "git-config"
        ? { note: "inferred from the effective local Git configuration" }
        : input.provenance.commitAs === "omitted"
          ? { note: "omitted for a read-only configuration" }
          : {}),
  });

  const actors = [
    ...new Set(
      config.credentials.github
        .filter((group) => group.actions.some(isApiAction))
        .map((group) => group.actAs ?? "caller's connected GitHub account"),
    ),
  ];
  rows.push({
    label: "API actor",
    value: actors.length > 0 ? actors.map(safeText).join(", ") : "none",
    ...(input.provenance.actor === "gh"
      ? { note: "from the active gh account" }
      : input.provenance.actor === "vercel-account-link"
        ? { note: "from the GitHub account linked to Vercel" }
        : input.provenance.actor === "explicit"
          ? { note: "from --credentials-act-as" }
          : {}),
  });

  rows.push({
    label: "Resources",
    value: `${input.vcpus} vCPUs`,
    ...(input.vcpusExplicit
      ? { note: "from --vcpus" }
      : { note: "managed-credentials default" }),
  });

  rows.push({ label: "Configuration", value: safeText(input.originLabel) });

  if (input.missingBounds.length > 0) {
    for (const line of describeMissingBounds(input.missingBounds)) {
      rows.push({
        label: "Policy addition",
        value: safeText(line),
        note: "raises the project-wide ceiling for everyone in the project",
      });
    }
  }

  return rows;
}

/** Render the review model as aligned text. */
export function renderReview(rows: readonly ReviewRow[]): string {
  const width = Math.max(...rows.map((row) => row.label.length));
  return rows
    .map((row) => {
      const label = row.label.padEnd(width);
      return row.note
        ? `  ${label}  ${row.value}\n  ${" ".repeat(width)}  └ ${row.note}\n`
        : `  ${label}  ${row.value}\n`;
    })
    .join("");
}

export type ReviewDecision =
  | { action: "create" }
  | { action: "cancel" }
  | { action: "edit"; field: EditableField };

const FIELD_PROMPTS: Record<EditableField, string> = {
  team: "team",
  project: "project",
  repository: "repository",
  actions: "GitHub API actions",
  commitAs: "commit credit",
  actAs: "GitHub API actor",
};

/**
 * Ask the user to create, edit, or cancel.
 *
 * Cancellation happens before any write, and the default on an empty answer is
 * to cancel rather than to create.
 */
export async function promptReviewDecision(options: {
  /** Fields this proposal's origin allows correcting. */
  editable?: readonly EditableField[];
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): Promise<ReviewDecision> {
  const answer = await question(
    "Create this sandbox, edit a value, or cancel? (c/e/N) ",
    options,
  );
  const normalized = answer.trim().toLowerCase();
  if (/^(c|create|y|yes)$/.test(normalized)) return { action: "create" };
  if (/^(e|edit)$/.test(normalized)) {
    const field = await promptField(
      options.editable ?? EDITABLE_FIELDS,
      options,
    );
    return field ? { action: "edit", field } : { action: "cancel" };
  }
  return { action: "cancel" };
}

async function promptField(
  editable: readonly EditableField[],
  options: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
  },
): Promise<EditableField | undefined> {
  const list = editable
    .map((field, index) => `    ${index + 1}. ${FIELD_PROMPTS[field]}`)
    .join("\n");
  const answer = await question(
    `  Which value?\n${list}\n  Enter a number or name: `,
    options,
  );
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return undefined;
  const byIndex = Number(normalized);
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= editable.length) {
    return editable[byIndex - 1];
  }
  return editable.find(
    (field) =>
      field.toLowerCase() === normalized ||
      FIELD_PROMPTS[field].toLowerCase() === normalized,
  );
}

/** Ask one free-text question, cancelling on EOF or SIGINT. */
export function question(
  prompt: string,
  options: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: options.input ?? process.stdin,
      output: options.output ?? process.stderr,
    });
    let answered = false;
    const cancel = () => {
      if (!answered) {
        reject(
          new CliError("Sandbox creation canceled.", {
            reason: "canceled",
            exitCode: 130,
          }),
        );
      }
      rl.close();
    };
    rl.once("SIGINT", cancel);
    rl.once("close", () => {
      if (!answered) {
        reject(
          new CliError("Sandbox creation canceled.", {
            reason: "canceled",
            exitCode: 130,
          }),
        );
      }
    });
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}
