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
import type { InferredActor } from "./managed-credentials-identity";

/** Strip control and bidirectional characters before display. */
export const safeText = (text: string) =>
  text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, "");

export interface ReviewInput {
  config: ManagedCredentialsConfig;
  originLabel: string;
  provenance: ConfigProvenance;
  actor?: InferredActor;
  edited?: readonly EditableField[];
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
  /** Why this value was chosen, shown in the third column. */
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
  const { config, provenance } = input;
  const edited = new Set(input.edited);
  const origin = `from ${safeText(input.originLabel || "the resolved configuration")}`;
  const source = (field: EditableField, inferred: string) =>
    edited.has(field) ? "edited during review" : inferred;
  const rows: ReviewRow[] = [
    {
      label: "Team",
      value: safeText(input.team),
      note: provenance.team ?? "provided scope",
    },
    {
      label: "Project",
      value: safeText(input.project),
      note: provenance.project ?? "provided scope",
    },
    {
      label: "Sandbox",
      value: input.sandboxName
        ? safeText(input.sandboxName)
        : "new sandbox (name assigned by the server)",
      note: input.sandboxName ? "from --name" : "assigned by the server",
    },
    {
      label: "Source",
      value: config.source
        ? safeText(config.source.repo)
        : "none (no repository cloned)",
      note: source(
        "repository",
        !config.source
          ? "no clone requested"
          : provenance.repository === "git-remote"
            ? "inferred from the local Git remote"
            : provenance.repository === "explicit"
              ? "from --credentials-github-repo"
              : origin,
      ),
    },
  ];
  if (config.source?.revision)
    rows.push({
      label: "Revision",
      value: safeText(config.source.revision),
      note: origin,
    });

  const actionSource =
    provenance.actions === "github-access"
      ? "from --github-access"
      : provenance.actions === "explicit"
        ? "from --credentials-github-action"
        : provenance.actions === "config" || provenance.repository === "config"
          ? origin
          : "default GitHub API actions";
  const actorSource =
    provenance.actor === "gh"
      ? "inferred from active gh account"
      : provenance.actor === "vercel-account-link"
        ? "from Vercel-linked GitHub account"
        : provenance.actor === "explicit"
          ? "from --credentials-github-act-as"
          : provenance.actor === "config"
            ? origin
            : "selected by the backend";
  let actorRows = 0;
  for (const group of config.credentials.github) {
    const api = group.actions.filter(isApiAction);
    rows.push({
      label: `Access ${safeText(group.repo)}`,
      value: api.length ? api.join(", ") : "no GitHub API actions",
      note: source(
        "actions",
        api.length
          ? actionSource
          : `${origin}; explicitly empty; defaults are not added`,
      ),
    });
    if (api.length) {
      actorRows++;
      rows.push({
        label:
          config.credentials.github.length === 1
            ? "API actor"
            : `API actor ${safeText(group.repo)}`,
        value: displayActor(group.actAs, input.actor),
        note: source(
          "actAs",
          group.actAs === undefined
            ? `backend default; no actor set in ${safeText(input.originLabel)}`
            : actorSource,
        ),
      });
    }
  }
  if (!actorRows)
    rows.push({
      label: "API actor",
      value: "none",
      note: "no GitHub API access requested",
    });

  const sourceGit = config.source
    ? gitAccessFor(config, config.source.repo)
    : undefined;
  const gitSource = !sourceGit
    ? "no Git access requested"
    : provenance.gitAccess === "github-access"
      ? `from --github-access=${sourceGit === "git:read" ? "read" : "write"}`
      : provenance.gitAccess === "config" || provenance.repository === "config"
        ? origin
        : provenance.gitAccess === "explicit" || sourceGit === "git:read"
          ? `from --credentials-github-no-write${sourceGit === "git:write" ? "=false" : ""}`
          : "default for a managed source";
  rows.push({
    label: "Git access",
    value: sourceGit ?? "none",
    note: gitSource,
  });

  const creditSource =
    provenance.commitAs === "git-config"
      ? "inferred from Git configuration"
      : provenance.commitAs === "profile-fallback"
        ? "inferred from the resolved GitHub profile"
        : provenance.commitAs === "explicit"
          ? "from --credentials-github-commit-as"
          : provenance.commitAs === "omitted"
            ? "omitted for a read-only configuration"
            : provenance.commitAs === "config" ||
                provenance.repository === "config"
              ? origin
              : config.commitAs
                ? "from the resolved configuration"
                : "no commit credit requested";
  rows.push({
    label: "Commit credit",
    value: config.commitAs
      ? `${safeText(config.commitAs.name)} <${safeText(config.commitAs.email)}>`
      : "none",
    note:
      source("commitAs", creditSource) +
      (hasInertCommitAs(config) ? "; no effect without Git write access" : ""),
  });
  rows.push({
    label: "Resources",
    value: `${input.vcpus} vCPUs`,
    note: input.vcpusExplicit ? "from --vcpus" : "managed-credentials default",
  });
  for (const line of describeMissingBounds(input.missingBounds))
    rows.push({
      label: "Policy addition",
      value: safeText(line),
      note: "policy comparison; raises the project-wide ceiling for everyone in the project",
    });
  return rows;
}

/** Display metadata cannot change or substitute an authorization selector. */
function displayActor(
  selector: string | undefined,
  actor: InferredActor | undefined,
): string {
  if (selector?.startsWith("@")) return safeText(selector);
  if (selector && actor?.actAs === selector && actor.login) {
    const login = safeText(actor.login).replace(/^@/, "").trim();
    if (login) return `@${login}`;
  }
  return selector
    ? "GitHub username unavailable"
    : "caller's connected GitHub account";
}

/** Render complete values and provenance in three aligned, wrapping columns. */
export function renderReview(
  rows: readonly ReviewRow[],
  columns = process.stderr.columns ?? 120,
): string {
  const width = Math.max(
    40,
    Math.floor(Number.isFinite(columns) ? columns : 120),
  );
  const available = width - 6;
  const labelWidth = Math.min(
    Math.max(7, ...rows.map((row) => Array.from(safeText(row.label)).length)),
    Math.floor(available * 0.25),
  );
  const sourceWidth = Math.min(
    Math.max(
      4,
      ...rows.map(
        (row) => Array.from(safeText(row.note ?? "not specified")).length,
      ),
    ),
    Math.floor(available * 0.35),
  );
  const valueWidth = Math.min(
    Math.max(5, ...rows.map((row) => Array.from(safeText(row.value)).length)),
    available - labelWidth - sourceWidth,
  );
  const table = [{ label: "Setting", value: "Value", note: "From" }, ...rows];
  return table
    .map((row) => {
      const cells = [
        wrapReviewCell(row.label, labelWidth),
        wrapReviewCell(row.value, valueWidth),
        wrapReviewCell(row.note ?? "not specified", sourceWidth),
      ];
      return Array.from(
        { length: Math.max(...cells.map((cell) => cell.length)) },
        (_, line) =>
          `  ${padReviewCell(cells[0][line] ?? "", labelWidth)}  ${padReviewCell(cells[1][line] ?? "", valueWidth)}  ${cells[2][line] ?? ""}`.trimEnd() +
          "\n",
      ).join("");
    })
    .join("");
}

function padReviewCell(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - Array.from(text).length));
}

function wrapReviewCell(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of safeText(text).split(/\s+/).filter(Boolean)) {
    if (line && Array.from(`${line} ${word}`).length > width) {
      lines.push(line);
      line = "";
    }
    let remaining = Array.from(word);
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width).join(""));
      remaining = remaining.slice(width);
    }
    const tail = remaining.join("");
    if (tail) line = line ? `${line} ${tail}` : tail;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
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
