import { describe, expect, test, vi } from "vitest";
import { SANDBOX_GITHUB_CREDENTIAL_ACTIONS } from "@vercel/sandbox";
import {
  ACCEPTED_API_ACTION_NAMES,
  DEFAULT_API_ACTIONS,
  canonicalAction,
  canonicalCreationAction,
  githubActor,
  gitAccessFor,
  parseConfig,
  repositoryFromUrl,
  repositoryGroups,
  repositoryUrl,
  serializeConfig,
  sourceRepository,
} from "../../src/util/managed-credentials-config";
import { CliError } from "../../src/util/cli-error";

vi.mock(
  "@vercel/sandbox",
  () => import("../../../vercel-sandbox/src/managed-credentials"),
);

const base = {
  source: { type: "git", url: "https://github.com/vercel/api.git" },
  credentials: {
    github: [
      {
        repositories: ["vercel/api"],
        actions: ["github:issues:read", "git:write"],
      },
    ],
  },
};

describe("action names", () => {
  test("maps short names to canonical GitHub action names", () => {
    expect(canonicalAction("issues:read")).toBe("github:issues:read");
    expect(canonicalAction("pull-request:create")).toBe(
      "github:pull-request:create",
    );
  });

  test("accepts already-canonical names unchanged", () => {
    expect(canonicalAction("github:issues:comment")).toBe(
      "github:issues:comment",
    );
  });

  test("keeps Git actions in their own namespace", () => {
    expect(canonicalAction("git:read")).toBe("git:read");
    expect(canonicalAction("git:write")).toBe("git:write");
  });

  test("rejects unknown actions", () => {
    expect(canonicalAction("issues:delete")).toBeUndefined();
    expect(canonicalAction("github:repo:admin")).toBeUndefined();
  });

  test("does not advertise Git actions as --credentials-github-action values", () => {
    expect(ACCEPTED_API_ACTION_NAMES).not.toContain("git:write");
    expect(ACCEPTED_API_ACTION_NAMES).toContain("issues:read");
  });

  test("the documented default set is exactly three API actions", () => {
    expect(DEFAULT_API_ACTIONS).toEqual([
      "github:issues:read",
      "github:issues:comment",
      "github:pull-request:create",
    ]);
  });
});

describe("repository helpers", () => {
  test.each([
    ["https://github.com/vercel/api", "vercel/api"],
    ["https://github.com/vercel/api.git", "vercel/api"],
    ["https://github.com/vercel/api/", "vercel/api"],
  ])("parses %s", (url, expected) => {
    expect(repositoryFromUrl(url)).toBe(expected);
  });

  test.each([
    "http://github.com/vercel/api",
    "https://gitlab.com/vercel/api",
    "https://user:pass@github.com/vercel/api",
  ])("rejects %s", (url) => {
    expect(repositoryFromUrl(url)).toBeUndefined();
  });

  test("builds a canonical clone URL", () => {
    expect(repositoryUrl("vercel/api")).toBe(
      "https://github.com/vercel/api.git",
    );
  });
});

describe("canonical API documents", () => {
  test("accepts complete repository arrays without normalizing or regrouping", () => {
    const document = {
      source: {
        depth: 2,
        url: "https://github.com/Acme/Source/",
        revision: "feature/API",
        type: "git",
      },
      credentials: {
        github: [
          {
            repositories: ["acme/two", "Acme/Source"],
            actions: ["git:write-workflows", "github:issues:read", "git:write"],
            actAs: "42",
          },
          {
            repositories: ["acme/three"],
            actions: ["git:write-workflows", "github:issues:read", "git:write"],
            actAs: "42",
          },
        ],
      },
    };
    const before = structuredClone(document);
    const parsed = parseConfig(document);
    expect(parsed).toEqual(before);
    expect(JSON.parse(serializeConfig(parsed))).toEqual(before);
    expect(serializeConfig(parsed)).toBe(
      `${JSON.stringify(before, null, 2)}\n`,
    );
    expect(Object.keys(parsed.source!)).toEqual(Object.keys(document.source));
    expect(document).toEqual(before);
  });
});

describe("canonical validation and views", () => {
  test("accepts exactly the create API action registry", () => {
    expect(SANDBOX_GITHUB_CREDENTIAL_ACTIONS).toHaveLength(13);
    const config = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["acme/one", "acme/two"],
            actions: [...SANDBOX_GITHUB_CREDENTIAL_ACTIONS],
          },
        ],
      },
    });
    expect(config.credentials.github[0].actions).toEqual(
      SANDBOX_GITHUB_CREDENTIAL_ACTIONS,
    );
  });

  test.each([
    "issues:read",
    "pull-request:create",
    "git:read",
    " github:issues:read",
    "github:issues:read ",
  ])("rejects file action aliases or unsupported actions: %s", (action) => {
    expect(() =>
      parseConfig({
        credentials: { github: [{ repositories: ["o/r"], actions: [action] }] },
      }),
    ).toThrow(CliError);
  });

  test("keeps alias normalization available only for flag callers", () => {
    expect(githubActor.parse("scubbo")).toBe("@scubbo");
    expect(githubActor.parse("123456")).toBe("123456");
    expect(canonicalCreationAction("issues:read")).toBe("github:issues:read");
    expect(canonicalCreationAction("git:read")).toBeUndefined();
  });

  test("flattens every repository into a disposable view in input order", () => {
    const config = parseConfig({
      source: { type: "git", url: "https://github.com/Acme/Source/" },
      credentials: {
        github: [
          {
            repositories: ["acme/two", "Acme/Source"],
            actions: ["github:issues:read", "git:write"],
            actAs: "42",
          },
          {
            repositories: ["acme/three", "acme/two"],
            actions: ["git:write-workflows"],
          },
        ],
      },
    });
    const before = structuredClone(config);
    const groups = repositoryGroups(config);
    expect(groups).toEqual([
      {
        repo: "acme/two",
        actions: ["github:issues:read", "git:write"],
        actAs: "42",
      },
      {
        repo: "Acme/Source",
        actions: ["github:issues:read", "git:write"],
        actAs: "42",
      },
      { repo: "acme/three", actions: ["git:write-workflows"] },
      { repo: "acme/two", actions: ["git:write-workflows"] },
    ]);
    expect(sourceRepository(config)).toBe("Acme/Source");
    expect(gitAccessFor(config, "ACME/SOURCE")).toBe("git:write");
    expect(gitAccessFor(config, "acme/two")).toBe("git:write-workflows");
    groups[0].actions.reverse();
    groups[1].repo = "another/repository";
    groups[2].actAs = "@another";
    groups.pop();
    expect(config).toEqual(before);
    expect(
      sourceRepository(parseConfig({ credentials: { github: [] } })),
    ).toBeUndefined();
  });

  test("checks every repository array entry for numeric actor conflicts", () => {
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            {
              repositories: ["o/one", "O/Shared"],
              actions: ["git:write"],
              actAs: "1",
            },
            {
              repositories: ["o/shared"],
              actions: ["github:issues:read"],
              actAs: "@alias",
            },
            {
              repositories: ["o/two", "o/shared"],
              actions: ["github:issues:comment"],
              actAs: "2",
            },
          ],
        },
      }),
    ).toThrow(/one actAs per repository/);
  });

  test("counts distinct repositories across complete arrays and the source", () => {
    const repositories = Array.from({ length: 25 }, (_, i) => `o/repo-${i}`);
    const value = {
      source: { type: "git", url: "https://github.com/o/repo-0.git" },
      credentials: {
        github: [
          { repositories: repositories.slice(0, 15), actions: ["git:write"] },
          {
            repositories: [...repositories.slice(15), "O/REPO-0"],
            actions: ["github:issues:read"],
          },
        ],
      },
    };
    expect(() => parseConfig(value)).not.toThrow();
    value.credentials.github[1].repositories.push("o/repo-25");
    expect(() => parseConfig(value)).toThrow(
      /at most 25 distinct repositories/,
    );
  });

  test.each([
    { repositories: [], actions: ["git:write"] },
    {
      repositories: ["o/one", "not-a-repository"],
      actions: ["git:write"],
    },
    { repositories: ["o/one"], actions: [] },
    { repositories: ["o/one"], actions: ["git:write", "git:write"] },
  ])("rejects incomplete or invalid groups: %j", (group) => {
    expect(() => parseConfig({ credentials: { github: [group] } })).toThrow(
      CliError,
    );
  });
});

describe("safe source validation", () => {
  test.each([
    "https://unsafe-user:unsafe-secret@github.com/o/r.git",
    "https://unsafe-secret@github.com/o/r.git",
    "https://github.com/o/r.git?token=unsafe-secret",
    "https://github.com/o/r.git#unsafe-secret",
    "https://gitlab.com/o/unsafe-secret.git",
    "http://github.com/o/unsafe-secret.git",
    "git@github.com:o/unsafe-secret.git",
  ])(
    "rejects unsafe or unsupported URLs without echoing their values",
    (url) => {
      let caught: unknown;
      try {
        parseConfig({
          source: { type: "git", url },
          credentials: { github: [] },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CliError);
      const error = caught as CliError;
      expect(error.message).toContain("source.url");
      expect(`${error.message} ${JSON.stringify(error.options)}`).not.toContain(
        "unsafe-secret",
      );
      expect(`${error.message} ${JSON.stringify(error.options)}`).not.toContain(
        url,
      );
    },
  );

  test.each([
    { url: "https://github.com/o/r.git" },
    { type: "tarball", url: "https://github.com/o/r.git" },
    { type: "git", url: "https://github.com/o/r.git", credentials: true },
    {
      type: "git",
      url: "https://github.com/o/r.git",
      username: "unsafe-secret",
    },
    {
      type: "git",
      url: "https://github.com/o/r.git",
      password: "unsafe-secret",
    },
    { type: "git", url: "https://github.com/o/r.git", depth: 0 },
    { type: "git", url: "https://github.com/o/r.git", revision: "" },
  ])(
    "requires an explicit git type and supported source options: %j",
    (source) => {
      expect(() =>
        parseConfig({ source, credentials: { github: [] } }),
      ).toThrow(CliError);
    },
  );

  test("rejects generic creation fields instead of pretending to parse CreateSandboxBody", () => {
    expect(() =>
      parseConfig({ ...base, projectId: "prj_123", resources: { vcpus: 2 } }),
    ).toThrow(CliError);
  });
});

describe("configuration parsing", () => {
  test("does not echo an accidental secret from an invalid action", () => {
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            { repositories: ["o/r"], actions: ["accidental-secret-value"] },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            { repositories: ["o/r"], actions: ["accidental-secret-value"] },
          ],
        },
      }),
    ).not.toThrow("accidental-secret-value");
  });
  test("accepts canonical API actions unchanged", () => {
    const config = parseConfig(base);
    expect(config.credentials.github[0].actions).toEqual([
      "github:issues:read",
      "git:write",
    ]);
  });

  test.each([123456, "scubbo", "0", "01", "9007199254740992", "@", " @scubbo"])(
    "rejects noncanonical file actors: %s",
    (actAs) => {
      expect(() =>
        parseConfig({
          credentials: {
            github: [
              {
                repositories: ["vercel/api"],
                actions: ["github:issues:read"],
                actAs,
              },
            ],
          },
        }),
      ).toThrow(CliError);
    },
  );

  test("accepts a string numeric actAs", () => {
    const config = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["github:issues:read"],
            actAs: "123456",
          },
        ],
      },
    });
    expect(config.credentials.github[0].actAs).toBe("123456");
  });

  test("preserves a canonical username's spelling", () => {
    const config = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["github:issues:read"],
            actAs: "@Scubbo",
          },
        ],
      },
    });
    expect(config.credentials.github[0].actAs).toBe("@Scubbo");
  });

  test("rejects a numeric actAs that lost precision in JSON", () => {
    // 2^53 cannot be represented exactly, so it may not name the account the
    // author meant.
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            {
              repositories: ["vercel/api"],
              actions: ["github:issues:read"],
              actAs: 9007199254740993,
            },
          ],
        },
      }),
    ).toThrow(CliError);
  });

  test("keeps an explicitly empty action list empty", () => {
    const config = parseConfig({ credentials: { github: [] } });
    expect(config.credentials.github).toEqual([]);
  });

  test("rejects unknown fields", () => {
    expect(() =>
      parseConfig({ credentials: { github: [] }, expiry: "1h" }),
    ).toThrow(CliError);
  });

  test("rejects raw credentials in a source", () => {
    expect(() =>
      parseConfig({
        source: {
          type: "git",
          url: "https://github.com/vercel/api.git",
          username: "x",
          password: "y",
        },
        credentials: { github: [] },
      }),
    ).toThrow(CliError);
  });

  test("rejects conflicting numeric identities for one repository", () => {
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            {
              repositories: ["vercel/api"],
              actions: ["github:issues:read"],
              actAs: "1",
            },
            {
              repositories: ["vercel/api"],
              actions: ["github:issues:comment"],
              actAs: "2",
            },
          ],
        },
      }),
    ).toThrow(/one actAs per repository/);
  });

  test.each([undefined, "@alias"])(
    "detects numeric conflicts after a first actor of %s",
    (actAs) => {
      expect(() =>
        parseConfig({
          credentials: {
            github: [
              {
                repositories: ["o/r"],
                actions: ["github:issues:read"],
                ...(actAs ? { actAs } : {}),
              },
              {
                repositories: ["O/R"],
                actions: ["github:issues:comment"],
                actAs: "1",
              },
              {
                repositories: ["o/r"],
                actions: ["github:pull-request:create"],
                actAs: "2",
              },
            ],
          },
        }),
      ).toThrow("one actAs per repository");
    },
  );

  test("does not report a conflict between two usernames the server resolves", () => {
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            {
              repositories: ["vercel/api"],
              actions: ["github:issues:read"],
              actAs: "@a",
            },
            {
              repositories: ["vercel/api"],
              actions: ["github:issues:comment"],
              actAs: "@b",
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  test("rejects more credential groups than the documented maximum", () => {
    expect(() =>
      parseConfig({
        credentials: {
          github: Array.from({ length: 26 }, (_, index) => ({
            repositories: [`vercel/repo-${index}`],
            actions: ["github:issues:read"],
          })),
        },
      }),
    ).toThrow(CliError);
  });

  test("counts the source toward the distinct-repository maximum", () => {
    // 25 groups are within the array cap, but the source adds a 26th distinct
    // repository.
    expect(() =>
      parseConfig({
        source: {
          type: "git",
          url: "https://github.com/vercel/source-only.git",
        },
        credentials: {
          github: Array.from({ length: 25 }, (_, index) => ({
            repositories: [`vercel/repo-${index}`],
            actions: ["github:issues:read"],
          })),
        },
      }),
    ).toThrow(/at most 25 distinct repositories/);
  });
});

describe("unsupported source fields and old CLI shapes", () => {
  test.each([
    { source: { repo: "acme/widgets" }, credentials: { github: [] } },
    {
      credentials: {
        github: [{ repo: "acme/widgets", actions: ["github:issues:read"] }],
      },
    },
    {
      credentials: {
        github: [
          {
            repo: "acme/widgets",
            repositories: ["acme/widgets"],
            actions: ["git:write"],
          },
        ],
      },
    },
    {
      source: {
        type: "git",
        url: "https://github.com/acme/widgets.git",
        repo: "acme/widgets",
      },
      credentials: { github: [] },
    },
  ])("rejects repo aliases rather than guessing permissions: %j", (value) => {
    expect(() => parseConfig(value)).toThrow(CliError);
  });

  test("rejects a transport read marker", () => {
    expect(() =>
      parseConfig({
        source: {
          type: "git",
          url: "https://github.com/acme/widgets.git",
          credentials: "read",
        },
        credentials: {
          github: [
            { repositories: ["acme/widgets"], actions: ["github:issues:read"] },
          ],
        },
      }),
    ).toThrow(CliError);
  });

  test("does not invent missing credential groups", () => {
    expect(() =>
      parseConfig({
        source: { type: "git", url: "https://github.com/acme/widgets.git" },
      }),
    ).toThrow(CliError);
  });

  test("rejects a non-GitHub legacy source", () => {
    expect(() =>
      parseConfig({
        source: { type: "git", url: "https://gitlab.com/acme/widgets.git" },
        credentials: { github: [] },
      }),
    ).toThrow(CliError);
  });
});

test("rejects commitAs like any other unknown configuration field", () => {
  expect(() =>
    parseConfig({
      ...base,
      commitAs: { name: "Ada", email: "ada@example.com" },
    }),
  ).toThrow("Unknown fields are not supported.");
});

describe("round trip", () => {
  test("serialized output parses back to the same configuration", () => {
    const config = parseConfig({
      source: {
        type: "git",
        url: "https://github.com/vercel/api.git",
        revision: "main",
        depth: 1,
      },
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["github:issues:read", "git:write"],
            actAs: "123456",
          },
          {
            repositories: ["vercel/front"],
            actions: ["github:pull-request:create"],
          },
        ],
      },
    });

    const reparsed = parseConfig(JSON.parse(serializeConfig(config)));
    expect(reparsed).toEqual(config);
  });

  test("serialized output is stable across a second round trip", () => {
    const once = serializeConfig(parseConfig(base));
    const twice = serializeConfig(parseConfig(JSON.parse(once)));
    expect(twice).toBe(once);
  });
});
