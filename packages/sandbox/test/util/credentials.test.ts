import { describe, expect, test, vi } from "vitest";
import { stripVTControlCharacters } from "node:util";
import type { CredentialsArgs } from "../../src/args/credentials.ts";
import {
  buildCredentials,
  renderEditCommand,
} from "../../src/util/credentials.ts";

const empty: CredentialsArgs = {
  credentials: undefined,
  credentialsGithubRepository: undefined,
  credentialsGithubActions: undefined,
  credentialsGithubActAs: undefined,
  credentialsFile: undefined,
};

const DEFAULT_ACTIONS = [
  "github:issues:read",
  "github:issues:comment",
  "github:pull-request:create",
  "git:write",
];

/** A checkout of acme/local, standing in for the current directory. */
const inLocalCheckout = async () => "acme/local";
const outsideCheckout = async () => undefined;

function text(error: unknown): string {
  return stripVTControlCharacters(
    error instanceof Error ? error.message : String(error),
  );
}

async function failure(
  args: CredentialsArgs,
  inferRepository = inLocalCheckout,
): Promise<string> {
  try {
    await buildCredentials(args, inferRepository);
  } catch (error) {
    return text(error);
  }
  throw new Error("expected buildCredentials to throw");
}

describe("buildCredentials", () => {
  test("requests nothing when no credentials option is given", async () => {
    const inferRepository = vi.fn(inLocalCheckout);
    await expect(buildCredentials(empty, inferRepository)).resolves.toEqual({});
    expect(inferRepository).not.toHaveBeenCalled();
  });

  test("requests npm credentials for --credentials=npm", async () => {
    const inferRepository = vi.fn(inLocalCheckout);
    await expect(
      buildCredentials({ ...empty, credentials: ["npm"] }, inferRepository),
    ).resolves.toEqual({ credentials: { npm: true } });
    expect(inferRepository).not.toHaveBeenCalled();
  });

  test("--credentials=github requests the default actions on the local repository and clones it", async () => {
    await expect(
      buildCredentials({ ...empty, credentials: ["github"] }, inLocalCheckout),
    ).resolves.toEqual({
      credentials: {
        github: [{ repositories: ["acme/local"], actions: DEFAULT_ACTIONS }],
      },
      source: { type: "git", url: "https://github.com/acme/local.git" },
      explicitOptions: [
        "--credentials-github-repository=acme/local",
        `--credentials-github-actions=${DEFAULT_ACTIONS.join(",")}`,
      ],
    });
  });

  test("--credentials=npm,github requests both", async () => {
    const request = await buildCredentials(
      { ...empty, credentials: ["npm", "github"] },
      inLocalCheckout,
    );
    expect(request.credentials).toEqual({
      npm: true,
      github: [{ repositories: ["acme/local"], actions: DEFAULT_ACTIONS }],
    });
    expect(request.explicitOptions).toEqual([
      "--credentials=npm",
      "--credentials-github-repository=acme/local",
      `--credentials-github-actions=${DEFAULT_ACTIONS.join(",")}`,
    ]);
  });

  test("a repository alone gets the default actions, without looking at the directory", async () => {
    const inferRepository = vi.fn(inLocalCheckout);
    await expect(
      buildCredentials(
        { ...empty, credentialsGithubRepository: "acme/web" },
        inferRepository,
      ),
    ).resolves.toEqual({
      credentials: {
        github: [{ repositories: ["acme/web"], actions: DEFAULT_ACTIONS }],
      },
      source: { type: "git", url: "https://github.com/acme/web.git" },
      explicitOptions: [
        "--credentials-github-repository=acme/web",
        `--credentials-github-actions=${DEFAULT_ACTIONS.join(",")}`,
      ],
    });
    expect(inferRepository).not.toHaveBeenCalled();
  });

  test("actions or an account alone apply to the local repository", async () => {
    await expect(
      buildCredentials(
        {
          ...empty,
          credentials: ["npm"],
          credentialsGithubActions: ["git:read"],
          credentialsGithubActAs: "@octocat",
        },
        inLocalCheckout,
      ),
    ).resolves.toEqual({
      credentials: {
        npm: true,
        github: [
          {
            repositories: ["acme/local"],
            actions: ["git:read"],
            actAs: "@octocat",
          },
        ],
      },
      source: { type: "git", url: "https://github.com/acme/local.git" },
      explicitOptions: [
        "--credentials=npm",
        "--credentials-github-repository=acme/local",
        "--credentials-github-actions=git:read",
        "--credentials-github-act-as=@octocat",
      ],
    });
  });

  test("a request that states the repository and the actions has nothing to make explicit", async () => {
    const request = await buildCredentials(
      {
        ...empty,
        credentialsGithubRepository: "acme/web",
        credentialsGithubActions: ["github:issues:read"],
        credentialsGithubActAs: "@octocat",
      },
      inLocalCheckout,
    );
    expect(request.credentials).toEqual({
      github: [
        {
          repositories: ["acme/web"],
          actions: ["github:issues:read"],
          actAs: "@octocat",
        },
      ],
    });
    expect(request).not.toHaveProperty("explicitOptions");
  });

  test.each([
    [
      "--credentials-github-repository",
      { credentialsGithubRepository: "acme/web" },
    ],
    [
      "--credentials-github-actions",
      { credentialsGithubActions: ["git:write" as const] },
    ],
    ["--credentials-github-act-as", { credentialsGithubActAs: "@octocat" }],
  ])("rejects --credentials=github with %s", async (option, args) => {
    expect(
      await failure({ ...empty, ...args, credentials: ["npm", "github"] }),
    ).toBe(
      [
        `Cannot combine --credentials=github with ${option}.`,
        "hint: github in --credentials requests the default GitHub access. To choose the repository, actions, or account yourself, remove github from --credentials and keep the --credentials-github-* options.",
      ].join("\n"),
    );
  });

  test("--credentials=github outside a GitHub checkout names the explicit option", async () => {
    expect(
      await failure({ ...empty, credentials: ["github"] }, outsideCheckout),
    ).toBe(
      [
        "Cannot find a GitHub repository in the current directory.",
        "hint: Run the command inside a clone of a github.com repository, or replace github in --credentials with --credentials-github-repository OWNER/REPOSITORY.",
      ].join("\n"),
    );
  });

  test("explicit options outside a GitHub checkout need a repository", async () => {
    expect(
      await failure(
        { ...empty, credentialsGithubActions: ["git:write"] },
        outsideCheckout,
      ),
    ).toBe(
      [
        "Cannot find a GitHub repository in the current directory.",
        "hint: Run the command inside a clone of a github.com repository, or add --credentials-github-repository OWNER/REPOSITORY.",
      ].join("\n"),
    );
  });

  test("sends a credentials file unchanged, without a clone source", async () => {
    const file = {
      npm: true as const,
      github: [
        {
          repositories: ["acme/web", "acme/api"],
          actions: ["git:write" as const],
        },
      ],
    };
    const inferRepository = vi.fn(inLocalCheckout);
    await expect(
      buildCredentials({ ...empty, credentialsFile: file }, inferRepository),
    ).resolves.toEqual({ credentials: file });
    expect(inferRepository).not.toHaveBeenCalled();
  });

  test.each([
    ["--credentials", { credentials: ["npm" as const] }],
    [
      "--credentials-github-repository",
      { credentialsGithubRepository: "acme/web" },
    ],
    [
      "--credentials-github-actions",
      { credentialsGithubActions: ["git:write" as const] },
    ],
    ["--credentials-github-act-as", { credentialsGithubActAs: "@octocat" }],
  ])("rejects --credentials-file with %s", async (_option, args) => {
    expect(
      await failure({ ...empty, ...args, credentialsFile: { npm: true } }),
    ).toBe(
      [
        "Cannot combine --credentials-file with other credentials options.",
        "hint: Put the whole request in the file. It replaces --credentials, --credentials-github-repository, --credentials-github-actions, and --credentials-github-act-as.",
      ].join("\n"),
    );
  });
});

describe("renderEditCommand", () => {
  const options = [
    "--credentials-github-repository=acme/web.app",
    "--credentials-github-actions=git:write,github:issues:read",
    "--credentials-github-act-as=@octocat",
  ];

  test("joins the scope and the options into one command", () => {
    expect(
      renderEditCommand({ team: "team_123", project: "my-web" }, options),
    ).toBe(
      "sandbox create --scope=team_123 --project=my-web --credentials-github-repository=acme/web.app --credentials-github-actions=git:write,github:issues:read --credentials-github-act-as=@octocat",
    );
  });

  // No quoting is right for every shell: POSIX quotes do nothing in cmd.exe.
  // A value that would need quoting therefore means no command at all.
  test.each([
    "$(touch pwned)",
    "team; touch pwned",
    "team & calc",
    "team | calc",
    "`touch pwned`",
    "%COMSPEC%",
    "team^",
    "a b",
    "it's",
    'say "hi"',
    "a\nb",
    "a\u001b[2Jb",
    "",
  ])("suggests no command when the team is %j", (team) => {
    expect(
      renderEditCommand({ team, project: "my-web" }, options),
    ).toBeUndefined();
    expect(
      renderEditCommand({ team: "team_123", project: team }, options),
    ).toBeUndefined();
  });
});
