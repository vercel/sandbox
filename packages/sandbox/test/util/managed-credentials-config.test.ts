import { describe, expect, test } from "vitest";
import {
  ACCEPTED_API_ACTION_NAMES,
  DEFAULT_API_ACTIONS,
  canonicalAction,
  gitAccessFor,
  hasInertCommitAs,
  parseConfig,
  repositoryFromUrl,
  repositoryUrl,
  serializeConfig,
} from "../../src/util/managed-credentials-config";
import { CliError } from "../../src/util/cli-error";

const base = {
  source: { repo: "vercel/api" },
  credentials: {
    github: [{ repo: "vercel/api", actions: ["issues:read", "git:write"] }],
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

  test("does not advertise Git actions as --credentials-action values", () => {
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

describe("configuration parsing", () => {
  test("accepts the logical shape and canonicalizes actions", () => {
    const config = parseConfig(base);
    expect(config.credentials.github[0].actions).toEqual([
      "github:issues:read",
      "git:write",
    ]);
  });

  test("accepts a numeric actAs from a configuration file", () => {
    const config = parseConfig({
      credentials: {
        github: [
          { repo: "vercel/api", actions: ["issues:read"], actAs: 123456 },
        ],
      },
    });
    expect(config.credentials.github[0].actAs).toBe("123456");
  });

  test("accepts a string numeric actAs", () => {
    const config = parseConfig({
      credentials: {
        github: [
          { repo: "vercel/api", actions: ["issues:read"], actAs: "123456" },
        ],
      },
    });
    expect(config.credentials.github[0].actAs).toBe("123456");
  });

  test("normalizes a bare username to @username", () => {
    const config = parseConfig({
      credentials: {
        github: [
          { repo: "vercel/api", actions: ["issues:read"], actAs: "scubbo" },
        ],
      },
    });
    expect(config.credentials.github[0].actAs).toBe("@scubbo");
  });

  test("rejects a numeric actAs that lost precision in JSON", () => {
    // 2^53 cannot be represented exactly, so it may not name the account the
    // author meant.
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            {
              repo: "vercel/api",
              actions: ["issues:read"],
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
        source: { repo: "vercel/api", username: "x", password: "y" },
        credentials: { github: [] },
      }),
    ).toThrow(CliError);
  });

  test("rejects conflicting numeric identities for one repository", () => {
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            { repo: "vercel/api", actions: ["issues:read"], actAs: 1 },
            { repo: "vercel/api", actions: ["issues:comment"], actAs: 2 },
          ],
        },
      }),
    ).toThrow(/one actAs per repository/);
  });

  test("does not report a conflict between two usernames the server resolves", () => {
    expect(() =>
      parseConfig({
        credentials: {
          github: [
            { repo: "vercel/api", actions: ["issues:read"], actAs: "@a" },
            { repo: "vercel/api", actions: ["issues:comment"], actAs: "@b" },
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
            repo: `vercel/repo-${index}`,
            actions: ["issues:read"],
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
        source: { repo: "vercel/source-only" },
        credentials: {
          github: Array.from({ length: 25 }, (_, index) => ({
            repo: `vercel/repo-${index}`,
            actions: ["issues:read"],
          })),
        },
      }),
    ).toThrow(/at most 25 distinct repositories/);
  });
});

describe("legacy transport-shaped files", () => {
  test("rejects transport-shaped source and groups instead of guessing rights", () => {
    expect(() =>
      parseConfig({
        source: { type: "git", url: "https://github.com/acme/widgets.git" },
        credentials: {
          github: [
            {
              repositories: ["acme/widgets", "acme/reference"],
              actions: ["github:issues:read"],
              actAs: "42",
            },
          ],
        },
      }),
    ).toThrow(CliError);
  });

  test("rejects a transport read marker even alongside commit metadata", () => {
    expect(() =>
      parseConfig({
        source: {
          type: "git",
          url: "https://github.com/acme/widgets.git",
          credentials: "read",
        },
        commitAs: { name: "Grace Hopper", email: "grace@example.com" },
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
        commitAs: { name: "Grace Hopper", email: "grace@example.com" },
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

describe("commitAs never widens a logical-shape configuration", () => {
  test("does not add git:write to an API-only group", () => {
    // The legacy reading of commitAs as "Git write" must not leak into the
    // logical shape, where Git access is stated as an action.
    const config = parseConfig({
      source: { repo: "o/r" },
      commitAs: { name: "A", email: "a@example.com" },
      credentials: { github: [{ repo: "o/r", actions: ["issues:read"] }] },
    });
    expect(config.credentials.github[0].actions).toEqual([
      "github:issues:read",
    ]);
    expect(gitAccessFor(config, "o/r")).toBeUndefined();
  });

  test("does not invent a group when none grants Git access", () => {
    const config = parseConfig({
      source: { repo: "o/r" },
      commitAs: { name: "A", email: "a@example.com" },
      credentials: { github: [] },
    });
    expect(config.credentials.github).toEqual([]);
  });

  test("leaves an explicit git:read source read-only", () => {
    const config = parseConfig({
      source: { repo: "o/r" },
      commitAs: { name: "A", email: "a@example.com" },
      credentials: {
        github: [{ repo: "o/r", actions: ["issues:read", "git:read"] }],
      },
    });
    expect(gitAccessFor(config, "o/r")).toBe("git:read");
  });
});

describe("inert commit metadata", () => {
  test("reports commitAs as inert when nothing grants Git write", () => {
    const config = parseConfig({
      source: { repo: "vercel/infra" },
      commitAs: { name: "John Fakenameson", email: "madeup@example.org" },
      credentials: {
        github: [{ repo: "vercel/infra", actions: ["git:read"] }],
      },
    });
    expect(hasInertCommitAs(config)).toBe(true);
    expect(gitAccessFor(config, "vercel/infra")).toBe("git:read");
  });

  test("reports commitAs as effective when Git write is granted", () => {
    expect(
      hasInertCommitAs(
        parseConfig({
          ...base,
          commitAs: { name: "Ada", email: "ada@example.com" },
        }),
      ),
    ).toBe(false);
  });
});

describe("round trip", () => {
  test("serialized output parses back to the same configuration", () => {
    const config = parseConfig({
      source: { repo: "vercel/api", revision: "main", depth: 1 },
      commitAs: { name: "Ada Lovelace", email: "ada@example.com" },
      credentials: {
        github: [
          {
            repo: "vercel/api",
            actions: ["issues:read", "git:write"],
            actAs: 123456,
          },
          { repo: "vercel/front", actions: ["pull-request:create"] },
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
