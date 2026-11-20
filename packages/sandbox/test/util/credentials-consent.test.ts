import { describe, expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { SandboxCredentials } from "@vercel/sandbox";
import { ExitError } from "../../src/error.ts";
import {
  confirmCredentials,
  renderCredentialsPreview,
} from "../../src/util/credentials-consent.ts";

const scope = { team: "team_123", project: "prj_123" };
const namedScope = { ...scope, teamSlug: "acme", projectSlug: "web" };

const github: SandboxCredentials = {
  github: [
    {
      repositories: ["acme/web"],
      actions: ["github:issues:read", "git:write"],
      actAs: "@octocat",
    },
  ],
};

/** Runs the consent step against scripted answers and captured output. */
async function run(options: {
  credentials?: SandboxCredentials;
  answers?: string[];
  yes?: boolean;
  interactive?: boolean;
  editCommand?: string;
  hasProjectBounds?: () => Promise<boolean>;
}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk) => (written += chunk));
  input.end((options.answers ?? []).map((answer) => `${answer}\n`).join(""));

  const hasProjectBounds = vi.fn(
    options.hasProjectBounds ?? (async () => true),
  );
  const result = await confirmCredentials({
    credentials: "credentials" in options ? options.credentials : github,
    scope: namedScope,
    yes: options.yes ?? false,
    interactive: options.interactive ?? true,
    editCommand: options.editCommand,
    hasProjectBounds,
    input,
    output,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  return {
    error: result,
    output: stripVTControlCharacters(written),
    hasProjectBounds,
  };
}

function message(error: unknown): string {
  return stripVTControlCharacters((error as Error).message);
}

describe("renderCredentialsPreview", () => {
  test("lists the team, project, repository, actions, and GitHub account", () => {
    expect(renderCredentialsPreview({ credentials: github, scope: namedScope }))
      .toBe(`  Team            acme
  Project         web
  Repository      acme/web
  Actions         github:issues:read
                  git:write
  GitHub account  @octocat
`);
  });

  test("falls back to team and project IDs, and names the default account", () => {
    expect(
      renderCredentialsPreview({
        credentials: {
          github: [
            { repositories: ["acme/web"], actions: ["git:read", "git:write"] },
          ],
        },
        scope,
      }),
    ).toBe(`  Team            team_123
  Project         prj_123
  Repository      acme/web
  Actions         git:read
                  git:write
  GitHub account  your connected GitHub account
`);
  });

  test("names no account for a grant that only reads with Git", () => {
    expect(
      renderCredentialsPreview({
        credentials: {
          github: [{ repositories: ["acme/web"], actions: ["git:read"] }],
        },
        scope: namedScope,
      }),
    ).toContain("  GitHub account  none, reading with Git needs no account\n");
  });

  test("lists every grant, and npm when it is requested", () => {
    expect(
      renderCredentialsPreview({
        credentials: {
          npm: true,
          github: [
            {
              repositories: ["acme/web", "acme/api"],
              actions: ["git:write"],
              actAs: "583231",
            },
            { repositories: ["acme/docs"], actions: ["github:issues:read"] },
          ],
        },
        scope: namedScope,
      }),
    ).toBe(`  Team            acme
  Project         web
  npm             the team's private packages
  Repositories    acme/web
                  acme/api
  Actions         git:write
  GitHub account  user ID 583231
  Repository      acme/docs
  Actions         github:issues:read
  GitHub account  your connected GitHub account
`);
  });

  test("strips control characters from team and project names", () => {
    expect(
      renderCredentialsPreview({
        credentials: github,
        scope: { ...scope, teamSlug: "ac\u001b[2Jme", projectSlug: "we\rb" },
      }),
    ).toContain("  Team            ac[2Jme\n  Project         web\n");
  });
});

describe("confirmCredentials", () => {
  test.each([undefined, { npm: true as const }, { github: [] }])(
    "asks nothing when no GitHub access is requested: %j",
    async (credentials) => {
      const result = await run({ credentials, interactive: false });
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("");
      expect(result.hasProjectBounds).not.toHaveBeenCalled();
    },
  );

  test("shows the request, then asks before creating", async () => {
    const result = await run({ answers: ["y"] });
    expect(result.error).toBeUndefined();
    expect(result.output).toBe(
      [
        "",
        renderCredentialsPreview({ credentials: github, scope: namedScope }),
        "Create this sandbox? (y/N) ",
      ].join("\n"),
    );
    expect(result.hasProjectBounds).toHaveBeenCalledOnce();
  });

  test.each([["yes"], ["Y"], [" y "]])("accepts %j", async (answer) => {
    expect((await run({ answers: [answer] })).error).toBeUndefined();
  });

  test.each([[["n"]], [[""]], [["maybe"]], [[]]])(
    "cancels on %j, before reading the project's Bounds",
    async (answers) => {
      const result = await run({ answers });
      expect(result.error).toBeInstanceOf(ExitError);
      expect(message(result.error)).toBe("Sandbox creation canceled.");
      expect((result.error as ExitError).exitCode).toBe(130);
      expect(result.hasProjectBounds).not.toHaveBeenCalled();
    },
  );

  const EDIT_COMMAND =
    "sandbox create --scope=team_123 --project=prj_123 --credentials-github-repository=acme/web";
  const EDIT_HINT = `\nTo change this request, edit and run:\n\n    ${EDIT_COMMAND}\n`;

  test("a declined request ends with the command to edit", async () => {
    const result = await run({ answers: ["n"], editCommand: EDIT_COMMAND });
    expect(result.output).toBe(
      [
        "",
        renderCredentialsPreview({ credentials: github, scope: namedScope }),
        `Create this sandbox? (y/N) ${EDIT_HINT}`,
      ].join("\n"),
    );
    expect((result.error as ExitError).exitCode).toBe(130);
  });

  test("a request that nobody can confirm ends with the command to edit", async () => {
    const result = await run({
      interactive: false,
      editCommand: EDIT_COMMAND,
    });
    expect(result.output).toBe(
      [
        "",
        renderCredentialsPreview({ credentials: github, scope: namedScope }),
      ].join("\n") + EDIT_HINT,
    );
    expect((result.error as ExitError).exitCode).toBe(2);
  });

  test("declining to continue without Bounds ends with the command to edit", async () => {
    const result = await run({
      answers: ["y", "n"],
      editCommand: EDIT_COMMAND,
      hasProjectBounds: async () => false,
    });
    expect(result.output.endsWith(EDIT_HINT)).toBe(true);
  });

  test.each([[["y"]], [[]]])(
    "an approved request does not print the command to edit: answers %j with --yes %#",
    async (answers) => {
      const result = await run({
        answers,
        yes: answers.length === 0,
        editCommand: EDIT_COMMAND,
      });
      expect(result.error).toBeUndefined();
      expect(result.output).not.toContain("To change this request");
    },
  );

  test("--yes skips the request and the question", async () => {
    const result = await run({ yes: true, interactive: false });
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("");
    expect(result.hasProjectBounds).toHaveBeenCalledOnce();
  });

  test("without --yes, a non-interactive run shows the request and stops", async () => {
    const result = await run({ interactive: false, answers: ["y"] });
    expect(result.output).toBe(
      [
        "",
        renderCredentialsPreview({ credentials: github, scope: namedScope }),
      ].join("\n"),
    );
    expect(result.error).toBeInstanceOf(ExitError);
    expect((result.error as ExitError).exitCode).toBe(2);
    expect(message(result.error)).toBe(
      [
        "Can't create a sandbox with GitHub credentials without confirmation in non-interactive mode.",
        "hint: Add --yes only after a person approves the request above.",
      ].join("\n"),
    );
    expect(result.hasProjectBounds).not.toHaveBeenCalled();
  });

  test("warns and asks again when the project has no Bounds", async () => {
    const result = await run({
      answers: ["y", "y"],
      hasProjectBounds: async () => false,
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain(
      [
        "Create this sandbox? (y/N) ",
        "This project has no Bounds, so nothing limits the GitHub access its sandboxes can request. This sandbox still gets only the access shown above.",
        "",
        "Continue without project Bounds? (y/N) ",
      ].join("\n"),
    );
  });

  test("cancels when the second question is declined", async () => {
    const result = await run({
      answers: ["y", "n"],
      hasProjectBounds: async () => false,
    });
    expect((result.error as ExitError).exitCode).toBe(130);
  });

  test("--yes still warns about missing Bounds, without asking", async () => {
    const result = await run({
      yes: true,
      hasProjectBounds: async () => false,
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toBe(
      "\nThis project has no Bounds, so nothing limits the GitHub access its sandboxes can request. This sandbox still gets only the access it requested.\n\n",
    );
  });

  test("stops when the project's Bounds cannot be read", async () => {
    const failure = new Error("unreadable");
    const result = await run({
      yes: true,
      hasProjectBounds: async () => {
        throw failure;
      },
    });
    expect(result.error).toBe(failure);
  });
});
