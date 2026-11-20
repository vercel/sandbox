import { createInterface, type Interface } from "node:readline";
import type {
  SandboxCredentials,
  SandboxGitHubCredential,
} from "@vercel/sandbox";
import { ExitError } from "../error";
import { fail } from "./fail";
import { printable } from "./printable";

interface Scope {
  team: string;
  project: string;
}

const LABEL_WIDTH = "GitHub account".length;

function row(label: string, values: readonly string[]): string {
  return values
    .map(
      (value, index) =>
        `  ${(index === 0 ? label : "").padEnd(LABEL_WIDTH)}  ${value}\n`,
    )
    .join("");
}

// Without actAs, the API acts as the GitHub account connected to the caller's
// Vercel account, and uses no account for a grant that only reads with Git.
function githubAccount({ actAs, actions }: SandboxGitHubCredential): string {
  if (actAs !== undefined) {
    return actAs.startsWith("@") ? actAs : `user ID ${actAs}`;
  }
  return actions.every((action) => action === "git:read")
    ? "none, reading with Git needs no account"
    : "your connected GitHub account";
}

function grantRows(grant: SandboxGitHubCredential): string {
  return [
    row(
      grant.repositories.length === 1 ? "Repository" : "Repositories",
      grant.repositories,
    ),
    row("Actions", grant.actions),
    row("GitHub account", [githubAccount(grant)]),
  ].join("");
}

/**
 * Renders what a credentials request acts on and what it grants, for a
 * person to check before the sandbox is created.
 *
 * The team and project are the exact values the request uses. A display name
 * from scope inference can belong to a different team or project, and consent
 * must name the one that receives the access.
 */
export function renderCredentialsPreview(options: {
  credentials: SandboxCredentials;
  scope: Scope;
}): string {
  const { credentials, scope } = options;
  return [
    row("Team", [printable(scope.team)]),
    row("Project", [printable(scope.project)]),
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
 *
 * A request that is not approved ends with `editCommand`, the command that
 * states the request in full, so a wrong guess can be corrected and rerun.
 */
export async function confirmCredentials(options: {
  credentials: SandboxCredentials | undefined;
  scope: Scope;
  yes: boolean;
  interactive: boolean;
  editCommand?: string;
  hasProjectBounds: () => Promise<boolean>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): Promise<void> {
  const { credentials, scope, yes, interactive, editCommand } = options;
  if (!credentials?.github?.length) {
    return;
  }
  const output = options.output ?? process.stderr;
  const offerEditCommand = () => {
    if (editCommand !== undefined) {
      output.write(
        `\nTo change this request, edit and run:\n\n    ${editCommand}\n`,
      );
    }
  };

  let lines: Interface | undefined;
  let answers: AsyncIterator<string> | undefined;
  const confirm = async (question: string): Promise<void> => {
    output.write(question);
    lines ??= createInterface({ input: options.input ?? process.stdin });
    answers ??= lines[Symbol.asyncIterator]();
    const answer = await answers.next();
    if (answer.done || !/^(y|yes)$/i.test(answer.value.trim())) {
      offerEditCommand();
      throw new ExitError("Sandbox creation canceled.", 130);
    }
  };

  try {
    if (!yes) {
      output.write(`\n${renderCredentialsPreview({ credentials, scope })}`);
      if (!interactive) {
        offerEditCommand();
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
