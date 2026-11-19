import { createInterface, type Interface } from "node:readline";
import type {
  SandboxCredentials,
  SandboxGitHubCredential,
} from "@vercel/sandbox";
import { ExitError } from "../error";
import { fail } from "./fail";

interface Scope {
  team: string;
  project: string;
  teamSlug?: string;
  projectSlug?: string;
}

const LABEL_WIDTH = "GitHub account".length;

// Team and project names come from the API, and a crafted name must not be
// able to rewrite the terminal.
function printable(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function row(label: string, values: readonly string[]): string {
  return values
    .map(
      (value, index) =>
        `  ${(index === 0 ? label : "").padEnd(LABEL_WIDTH)}  ${value}\n`,
    )
    .join("");
}

function githubAccount(actAs: string | undefined): string {
  if (actAs === undefined) {
    return "your connected GitHub account";
  }
  return actAs.startsWith("@") ? actAs : `user ID ${actAs}`;
}

function grantRows(grant: SandboxGitHubCredential): string {
  return [
    row(
      grant.repositories.length === 1 ? "Repository" : "Repositories",
      grant.repositories,
    ),
    row("Actions", grant.actions),
    row("GitHub account", [githubAccount(grant.actAs)]),
  ].join("");
}

/**
 * Renders what a credentials request acts on and what it grants, for a
 * person to check before the sandbox is created.
 */
export function renderCredentialsPreview(options: {
  credentials: SandboxCredentials;
  scope: Scope;
}): string {
  const { credentials, scope } = options;
  return [
    row("Team", [printable(scope.teamSlug ?? scope.team)]),
    row("Project", [printable(scope.projectSlug ?? scope.project)]),
    credentials.npm ? row("npm", ["the team's private packages"]) : "",
    ...(credentials.github ?? []).map(grantRows),
  ].join("");
}

/**
 * Gets consent for a request that gives a sandbox GitHub access. Returning
 * means the request was approved. A request without GitHub access needs no
 * consent.
 *
 * --yes answers both questions but never hides the missing-Bounds warning.
 * Nothing reads the terminal unless a question is asked, so stdin stays
 * available to the command that runs next.
 */
export async function confirmCredentials(options: {
  credentials: SandboxCredentials | undefined;
  scope: Scope;
  yes: boolean;
  interactive: boolean;
  hasProjectBounds: () => Promise<boolean>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): Promise<void> {
  const { credentials, scope, yes, interactive } = options;
  if (!credentials?.github?.length) {
    return;
  }
  const output = options.output ?? process.stderr;

  let lines: Interface | undefined;
  let answers: AsyncIterator<string> | undefined;
  const confirm = async (question: string): Promise<void> => {
    output.write(question);
    lines ??= createInterface({ input: options.input ?? process.stdin });
    answers ??= lines[Symbol.asyncIterator]();
    const answer = await answers.next();
    if (answer.done || !/^(y|yes)$/i.test(answer.value.trim())) {
      throw new ExitError("Sandbox creation canceled.", 130);
    }
  };

  try {
    if (!yes) {
      output.write(`\n${renderCredentialsPreview({ credentials, scope })}`);
      if (!interactive) {
        fail(
          "Can't create a sandbox with GitHub credentials without confirmation in non-interactive mode.",
          "Add --yes only after a person approves the request above.",
          2,
        );
      }
      await confirm("\nCreate this sandbox? (y/N) ");
    }

    if (!(await options.hasProjectBounds())) {
      output.write(
        `\nThis project has no Bounds, so nothing limits the GitHub access its sandboxes can request. This sandbox still gets only the access ${yes ? "it requested" : "shown above"}.\n\n`,
      );
      if (!yes) {
        await confirm("Continue without project Bounds? (y/N) ");
      }
    }
  } finally {
    lines?.close();
  }
}
