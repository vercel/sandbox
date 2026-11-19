import { describe, expect, test } from "vitest";
import { stripVTControlCharacters } from "node:util";
import type { CredentialsArgs } from "../../src/args/credentials.ts";
import { buildCredentials } from "../../src/util/credentials.ts";

const empty: CredentialsArgs = {
  credentials: undefined,
  credentialsGithubRepository: undefined,
  credentialsGithubActions: undefined,
  credentialsGithubActAs: undefined,
  credentialsFile: undefined,
};

function text(error: unknown): string {
  return stripVTControlCharacters(
    error instanceof Error ? error.message : String(error),
  );
}

function failure(args: CredentialsArgs): string {
  try {
    buildCredentials(args);
  } catch (error) {
    return text(error);
  }
  throw new Error("expected buildCredentials to throw");
}

describe("buildCredentials", () => {
  test("requests nothing when no credentials option is given", () => {
    expect(buildCredentials(empty)).toEqual({});
  });

  test("requests npm credentials for --credentials=npm", () => {
    expect(buildCredentials({ ...empty, credentials: ["npm"] })).toEqual({
      credentials: { npm: true },
    });
  });

  test("a repository alone gets the default actions and is cloned", () => {
    expect(
      buildCredentials({ ...empty, credentialsGithubRepository: "acme/web" }),
    ).toEqual({
      credentials: {
        github: [
          {
            repositories: ["acme/web"],
            actions: [
              "github:issues:read",
              "github:issues:comment",
              "github:pull-request:create",
              "git:write",
            ],
          },
        ],
      },
      source: { type: "git", url: "https://github.com/acme/web.git" },
    });
  });

  test("explicit actions replace the default actions, including Git access", () => {
    expect(
      buildCredentials({
        ...empty,
        credentialsGithubRepository: "acme/web",
        credentialsGithubActions: ["github:issues:read"],
        credentialsGithubActAs: "@octocat",
      }).credentials,
    ).toEqual({
      github: [
        {
          repositories: ["acme/web"],
          actions: ["github:issues:read"],
          actAs: "@octocat",
        },
      ],
    });
  });

  test("combines npm with explicit GitHub options", () => {
    expect(
      buildCredentials({
        ...empty,
        credentials: ["npm"],
        credentialsGithubRepository: "acme/web",
        credentialsGithubActions: ["git:read"],
      }).credentials,
    ).toEqual({
      npm: true,
      github: [{ repositories: ["acme/web"], actions: ["git:read"] }],
    });
  });

  test.each([
    [
      "--credentials-github-actions",
      { credentialsGithubActions: ["git:write" as const] },
    ],
    ["--credentials-github-act-as", { credentialsGithubActAs: "@octocat" }],
  ])("%s needs a repository", (option, args) => {
    expect(failure({ ...empty, ...args })).toBe(
      [
        `${option} needs a repository.`,
        "hint: Add --credentials-github-repository OWNER/REPOSITORY.",
      ].join("\n"),
    );
  });

  test("sends a credentials file unchanged, without a clone source", () => {
    const file = {
      npm: true as const,
      github: [
        {
          repositories: ["acme/web", "acme/api"],
          actions: ["git:write" as const],
        },
      ],
    };
    expect(buildCredentials({ ...empty, credentialsFile: file })).toEqual({
      credentials: file,
    });
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
  ])("rejects --credentials-file with %s", (_option, args) => {
    expect(failure({ ...empty, ...args, credentialsFile: { npm: true } })).toBe(
      [
        "Cannot combine --credentials-file with other credentials options.",
        "hint: Put the whole request in the file. It replaces --credentials, --credentials-github-repository, --credentials-github-actions, and --credentials-github-act-as.",
      ].join("\n"),
    );
  });
});
