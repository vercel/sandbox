import { createInterface } from "node:readline";
import { CliError } from "./cli-error";
import {
  type ManagedCredentialsConfig,
  repositoryGroups,
  sourceRepository,
} from "./managed-credentials-config";
import {
  describeMissingBounds,
  type MissingBound,
} from "./managed-credentials-bounds";
import type { ConfigProvenance } from "./managed-credentials-resolve";
import type { InferredActor } from "./managed-credentials-identity";
import { isScopeId } from "./scope-display";

/** Strip control and bidirectional characters before display. */
export const safeText = (text: string) =>
  text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, "");

export interface ReviewInput {
  config: ManagedCredentialsConfig;
  originLabel: string;
  provenance: ConfigProvenance;
  actor?: InferredActor;
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
 * Pure so tests can inspect the exact permissions and actor for every
 * repository, including Git-only groups without a clone source. Normal Git
 * attribution comes from the selected actor. Legacy overrides stay explicit.
 */
export function buildReview(input: ReviewInput): ReviewRow[] {
  const { config, provenance } = input;
  const groups = repositoryGroups(config);
  const origin = `from ${safeText(input.originLabel || "the resolved configuration")}`;
  const rows: ReviewRow[] = [
    {
      label: "Team",
      value: safeText(input.team),
      note:
        (provenance.team ?? "provided scope") +
        (isScopeId(input.team, "team") ? " (name lookup unavailable)" : ""),
    },
    {
      label: "Project",
      value: safeText(input.project),
      note:
        (provenance.project ?? "provided scope") +
        (isScopeId(input.project, "project")
          ? " (name lookup unavailable)"
          : ""),
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
        ? safeText(sourceRepository(config) ?? config.source.url)
        : "none (no repository cloned)",
      note: !config.source
        ? "no clone requested"
        : provenance.repository === "git-remote"
          ? "inferred from the local Git remote"
          : provenance.repository === "explicit"
            ? "from --credentials-github-repo"
            : origin,
    },
  ];
  if (config.source?.revision)
    rows.push({
      label: "Revision",
      value: safeText(config.source.revision),
      note: origin,
    });

  const actionSource =
    provenance.actions === "explicit"
      ? "from --credentials-github-action"
      : provenance.actions === "config" || provenance.repository === "config"
        ? origin
        : "default GitHub actions";
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
  const sourceForActor = (selector: string | undefined) =>
    selector === undefined
      ? `backend default; no actor set in ${safeText(input.originLabel)}`
      : actorSource;
  for (const group of groups) {
    rows.push({
      label: `Access ${safeText(group.repo)}`,
      value: group.actions.join(", "),
      note: actionSource,
    });
    rows.push({
      label:
        groups.length === 1
          ? "GitHub actor"
          : `GitHub actor ${safeText(group.repo)}`,
      value: displayActor(group.actAs, input.actor),
      note: sourceForActor(group.actAs),
    });
  }
  if (groups.length === 0) {
    rows.push({
      label: "GitHub actor",
      value: "none",
      note: "no credential access requested",
    });
  }

  const writingGroups = groups.filter((group) =>
    group.actions.some(
      (action) => action === "git:write" || action === "git:write-workflows",
    ),
  );
  const creditSources = [
    ...new Set(writingGroups.map((group) => sourceForActor(group.actAs))),
  ];
  const creditSource = config.commitAs
    ? `${origin}; legacy override`
    : writingGroups.length
      ? creditSources.length === 1
        ? creditSources[0]
        : "from each repository's GitHub actor"
      : "no Git writing requested";
  rows.push({
    label: "Commit credit",
    value: config.commitAs
      ? `${safeText(config.commitAs.name)} <${safeText(config.commitAs.email)}>`
      : writingGroups.length === 1
        ? `from ${displayActor(writingGroups[0].actAs, input.actor)}`
        : writingGroups.length
          ? "from each repository's GitHub actor"
          : "none",
    note: creditSource,
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

export type ReviewDecision = { action: "create" } | { action: "cancel" };

/** Ask once. Anything other than y/yes cancels before creation. */
export async function promptReviewDecision(options: {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): Promise<ReviewDecision> {
  const answer = await question("Create this sandbox? (y/n) ", options);
  return { action: /^(y|yes)$/i.test(answer.trim()) ? "create" : "cancel" };
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
