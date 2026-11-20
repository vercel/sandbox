import { describe, expect, test } from "vitest";
import { stripVTControlCharacters } from "node:util";
import {
  CREDENTIALS_FILE_SCHEMA,
  githubActionListType,
  githubActorType,
  checkGithubRepository,
  readCredentialsFile,
} from "../../src/args/credentials.ts";

function text(error: unknown): string {
  return stripVTControlCharacters(
    error instanceof Error ? error.message : String(error),
  );
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return text(error);
  }
  throw new Error("expected the promise to reject");
}

describe("--credentials-github-repository", () => {
  test("accepts OWNER/REPOSITORY", () => {
    expect(() => checkGithubRepository("acme/web.app")).not.toThrow();
  });

  test.each([
    "acme",
    "acme/web/app",
    "acme/..",
    "https://ghp_secret@github.com/acme/web",
  ])("rejects %s without repeating it", (value) => {
    let message = "";
    try {
      checkGithubRepository(value);
    } catch (error) {
      message = text(error);
    }
    expect(message).toBe(
      [
        "Invalid --credentials-github-repository value.",
        "hint: Use OWNER/REPOSITORY, for example acme/web.",
      ].join("\n"),
    );
  });
});

describe("--credentials-github-actions", () => {
  test("returns the actions in order, with whitespace trimmed", async () => {
    await expect(
      githubActionListType.from("git:write, github:pull-request:create"),
    ).resolves.toEqual(["git:write", "github:pull-request:create"]);
  });

  test("accepts GitHub API actions without the github: prefix", async () => {
    await expect(
      githubActionListType.from("issues:read,git:read"),
    ).resolves.toEqual(["github:issues:read", "git:read"]);
  });

  test("ignores empty and repeated items", async () => {
    await expect(
      githubActionListType.from("git:write,,issues:read,github:issues:read"),
    ).resolves.toEqual(["git:write", "github:issues:read"]);
  });

  test("rejects a list with no actions", async () => {
    expect(await failure(githubActionListType.from(" , "))).toBe(
      "GitHub actions cannot be empty.",
    );
  });

  test("rejects unsupported actions, listing the supported ones", async () => {
    const message = await failure(
      githubActionListType.from("git:write,git:delete,issues:close"),
    );
    expect(message).toContain(
      "Unsupported GitHub actions: git:delete, issues:close.",
    );
    expect(message).toContain(
      "hint: Supported: git:read, git:write, git:write-workflows, git:force-push, github:pull-request:create,",
    );
  });
});

describe("--credentials-github-act-as", () => {
  test.each([
    ["octocat", "@octocat"],
    ["@octocat", "@octocat"],
    ["583231", "583231"],
  ])("normalizes %s to %s", async (value, expected) => {
    await expect(githubActorType.from(value)).resolves.toBe(expected);
  });

  test.each(["-octocat", "octo cat", "0", "@"])("rejects %s", async (value) => {
    expect(await failure(githubActorType.from(value))).toBe(
      [
        "Invalid --credentials-github-act-as value.",
        "hint: Use a GitHub username, for example octocat, or a numeric GitHub user ID.",
      ].join("\n"),
    );
  });
});

describe("readCredentialsFile", () => {
  const SHAPE_HINT = `hint: ${CREDENTIALS_FILE_SCHEMA}`;

  const credentials = {
    npm: true,
    github: [
      {
        repositories: ["acme/web", "acme/api"],
        actions: ["git:write", "github:pull-request:create"],
        actAs: "@octocat",
      },
      { repositories: ["acme/docs"], actions: ["github:issues:read"] },
    ],
  };

  function reader(content: string) {
    return async () => content;
  }

  test("returns the credentials from the file", async () => {
    await expect(
      readCredentialsFile(
        "credentials.json",
        reader(JSON.stringify(credentials)),
      ),
    ).resolves.toEqual(credentials);
  });

  test("reads stdin for -", async () => {
    const read = async (path: string) => {
      expect(path).toBe("-");
      return '{"npm":true}';
    };
    await expect(readCredentialsFile("-", read)).resolves.toEqual({
      npm: true,
    });
  });

  test("accepts an empty github list, which grants no repository access", async () => {
    await expect(
      readCredentialsFile("credentials.json", reader('{"github":[]}')),
    ).resolves.toEqual({ github: [] });
  });

  test("lists each invalid path without values", async () => {
    const bad = {
      npm: false,
      gitlab: [],
      "forged\nhint: run this": 1,
      github: [
        {
          repositories: ["not-a-repository"],
          actions: ["issues:read"],
          actAs: "octocat",
          token: "ghp_secret",
          "two words": true,
        },
        { repositories: [], actions: [] },
      ],
    };
    const message = await failure(
      readCredentialsFile("credentials.json", reader(JSON.stringify(bad))),
    );
    expect(message).not.toContain("ghp_secret");
    expect(message).not.toContain("not-a-repository");
    expect(message).not.toContain("forged");
    expect(message).not.toContain("two words");
    expect(message).toBe(
      [
        "The credentials in credentials.json are invalid:",
        "  gitlab: unknown key",
        "  an unknown key whose name is not shown",
        "  npm: must be true",
        "  github[0].token: unknown key",
        "  github[0]: an unknown key whose name is not shown",
        "  github[0].repositories[0]: must be OWNER/REPOSITORY",
        "  github[0].actions[0]: unsupported action",
        "  github[0].actAs: must be a numeric GitHub user ID or an @-prefixed username",
        "  github[1].repositories: must not be empty",
        "  github[1].actions: must not be empty",
        SHAPE_HINT,
      ].join("\n"),
    );
  });

  test("rejects a file that requests nothing", async () => {
    expect(
      await failure(readCredentialsFile("credentials.json", reader("{}"))),
    ).toBe(
      [
        "The credentials in credentials.json are invalid:",
        "  must request at least one of npm or github",
        SHAPE_HINT,
      ].join("\n"),
    );
  });

  test("rejects JSON that is not an object", async () => {
    expect(
      await failure(readCredentialsFile("credentials.json", reader("[]"))),
    ).toBe(
      [
        "The credentials in credentials.json are invalid:",
        "  must be an object",
        SHAPE_HINT,
      ].join("\n"),
    );
  });

  test("reports invalid JSON by position, without quoting the input", async () => {
    expect(
      await failure(
        readCredentialsFile("-", reader('{"github":\n [] "ghp_secret"}')),
      ),
    ).toBe(
      [
        "The credentials in stdin are not valid JSON (line 2 column 5).",
        SHAPE_HINT,
      ].join("\n"),
    );
  });

  test("reports a file it cannot read by error code", async () => {
    expect(await failure(readCredentialsFile("missing.json"))).toBe(
      [
        "Cannot read the credentials file missing.json (ENOENT).",
        "hint: Pass a readable JSON file, or - to read stdin.",
      ].join("\n"),
    );
  });
});
