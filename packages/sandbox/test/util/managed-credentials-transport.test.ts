import { describe, expect, test, vi } from "vitest";
import { parseConfig } from "../../src/util/managed-credentials-config";
import { toTransport } from "../../src/util/managed-credentials-transport";

// Use the current SDK registry without requiring a package build first.
vi.mock(
  "@vercel/sandbox",
  () => import("../../../vercel-sandbox/src/managed-credentials"),
);

const transportFor = (value: unknown) => toTransport(parseConfig(value));

describe("canonical API forwarding", () => {
  test("preserves group and repository boundaries without mutating input", () => {
    const document = {
      source: { type: "git", url: "https://github.com/acme/source/", depth: 3 },
      credentials: {
        github: [
          {
            repositories: ["acme/two", "acme/source"],
            actions: ["github:issues:read", "git:write"],
            actAs: "42",
          },
          {
            repositories: ["acme/three"],
            actions: ["github:issues:read", "git:write"],
            actAs: "42",
          },
        ],
      },
    };
    const before = structuredClone(document);
    const config = parseConfig(document);
    for (const group of config.credentials.github) {
      Object.freeze(group.repositories);
      Object.freeze(group.actions);
      Object.freeze(group);
    }
    Object.freeze(config.source);
    Object.freeze(config.credentials.github);
    Object.freeze(config.credentials);
    Object.freeze(config);
    expect(toTransport(config)).toEqual(before);
    expect(JSON.stringify(toTransport(config))).toBe(JSON.stringify(before));
    expect(document).toEqual(before);
  });
});

describe("source mapping", () => {
  test("emits a plain source with exact revision, depth and explicit compatible commit metadata", () => {
    const commitAs = { name: "Ada", email: "ada@example.com" };
    const transport = transportFor({
      source: {
        type: "git",
        url: "https://github.com/Vercel/API.git",
        revision: "main",
        depth: 1,
      },
      commitAs,
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["github:issues:read", "git:write"],
          },
        ],
      },
    });
    expect(transport).toEqual({
      source: {
        type: "git",
        url: "https://github.com/Vercel/API.git",
        revision: "main",
        depth: 1,
      },
      commitAs,
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["github:issues:read", "git:write"],
          },
        ],
      },
    });
    expect(transport.source).not.toHaveProperty("credentials");
  });

  test("does not infer commit metadata for a writing source", () => {
    const transport = transportFor({
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: {
        github: [{ repositories: ["vercel/api"], actions: ["git:write"] }],
      },
    });
    expect(transport).not.toHaveProperty("commitAs");
    expect(transport.source).not.toHaveProperty("credentials");
  });

  test.each([
    undefined,
    { type: "git", url: "https://github.com/vercel/api.git" },
  ])(
    "rejects API-only commit metadata rather than silently omitting it (source: %j)",
    (source) => {
      expect(() =>
        transportFor({
          ...(source ? { source } : {}),
          commitAs: { name: "Ada", email: "ada@example.com" },
          credentials: {
            github: [
              { repositories: ["vercel/api"], actions: ["github:issues:read"] },
            ],
          },
        }),
      ).toThrow(/commitAs/);
    },
  );
});

describe("credential groups", () => {
  test("sends Git and GitHub API actions together with the exact identity", () => {
    const transport = transportFor({
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["github:issues:read", "git:write"],
            actAs: "@scubbo",
          },
        ],
      },
    });
    expect(transport.credentials).toEqual({
      github: [
        {
          repositories: ["vercel/api"],
          actions: ["github:issues:read", "git:write"],
          actAs: "@scubbo",
        },
      ],
    });
  });

  test("keeps repositories in their original groups even with identical actions and identity", () => {
    const transport = transportFor({
      credentials: {
        github: [
          {
            repositories: ["acme/one"],
            actions: ["github:issues:read"],
            actAs: "42",
          },
          {
            repositories: ["acme/two"],
            actions: ["github:issues:read"],
            actAs: "42",
          },
        ],
      },
    });
    expect(transport.credentials?.github).toEqual([
      {
        repositories: ["acme/one"],
        actions: ["github:issues:read"],
        actAs: "42",
      },
      {
        repositories: ["acme/two"],
        actions: ["github:issues:read"],
        actAs: "42",
      },
    ]);
  });

  test("keeps differing action sets and identities in separate groups", () => {
    const transport = transportFor({
      credentials: {
        github: [
          {
            repositories: ["acme/one"],
            actions: ["github:issues:read"],
            actAs: "42",
          },
          {
            repositories: ["acme/two"],
            actions: ["github:issues:read"],
            actAs: "43",
          },
          {
            repositories: ["acme/three"],
            actions: ["github:pull-request:create"],
            actAs: "42",
          },
        ],
      },
    });
    expect(transport.credentials?.github).toEqual([
      {
        repositories: ["acme/one"],
        actions: ["github:issues:read"],
        actAs: "42",
      },
      {
        repositories: ["acme/two"],
        actions: ["github:issues:read"],
        actAs: "43",
      },
      {
        repositories: ["acme/three"],
        actions: ["github:pull-request:create"],
        actAs: "42",
      },
    ]);
  });

  test("sends an empty group list rather than inventing defaults", () => {
    const transport = transportFor({ credentials: { github: [] } });
    expect(transport.credentials).toEqual({ github: [] });
  });

  test.each(["git:write", "git:write-workflows"])(
    "forwards a Git-only %s group without requiring a source",
    (action) => {
      expect(
        transportFor({
          credentials: {
            github: [
              {
                repositories: ["vercel/api"],
                actions: [action],
                actAs: "@scubbo",
              },
            ],
          },
        }),
      ).toEqual({
        credentials: {
          github: [
            {
              repositories: ["vercel/api"],
              actions: [action],
              actAs: "@scubbo",
            },
          ],
        },
      });
    },
  );

  test("retains identical mixed-action groups without collapsing or unioning permissions", () => {
    const actions = ["git:write", "git:write-workflows", "github:issues:read"];
    const transport = transportFor({
      credentials: {
        github: [
          { repositories: ["acme/one"], actions, actAs: "42" },
          { repositories: ["acme/two"], actions, actAs: "42" },
          { repositories: ["acme/three"], actions: ["git:write"], actAs: "42" },
          { repositories: ["acme/four"], actions, actAs: "43" },
        ],
      },
    });
    expect(transport.credentials?.github).toEqual([
      {
        repositories: ["acme/one"],
        actions: ["git:write", "git:write-workflows", "github:issues:read"],
        actAs: "42",
      },
      {
        repositories: ["acme/two"],
        actions: ["git:write", "git:write-workflows", "github:issues:read"],
        actAs: "42",
      },
      { repositories: ["acme/three"], actions: ["git:write"], actAs: "42" },
      {
        repositories: ["acme/four"],
        actions: ["git:write", "git:write-workflows", "github:issues:read"],
        actAs: "43",
      },
    ]);
    expect(transport).not.toHaveProperty("source");
    expect(transport).not.toHaveProperty("commitAs");
  });
});

describe("group action-set equality", () => {
  test("preserves action ordering and group boundaries even for equal action sets", () => {
    const config = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["acme/one"],
            actions: ["git:write-workflows", "git:write"],
            actAs: "42",
          },
          {
            repositories: ["acme/two"],
            actions: ["git:write", "git:write-workflows"],
            actAs: "42",
          },
          {
            repositories: ["acme/three"],
            actions: ["git:write", "git:write-workflows"],
          },
        ],
      },
    });
    const before = structuredClone(config);
    expect(toTransport(config).credentials?.github).toEqual([
      {
        repositories: ["acme/one"],
        actions: ["git:write-workflows", "git:write"],
        actAs: "42",
      },
      {
        repositories: ["acme/two"],
        actions: ["git:write", "git:write-workflows"],
        actAs: "42",
      },
      {
        repositories: ["acme/three"],
        actions: ["git:write", "git:write-workflows"],
      },
    ]);
    expect(config).toEqual(before);
  });
});

describe("unsupported create actions", () => {
  test.each([false, true])(
    "rejects git:read instead of dropping or upgrading it (source: %s)",
    (withSource) => {
      expect(() =>
        transportFor({
          ...(withSource
            ? {
                source: {
                  type: "git",
                  url: "https://github.com/vercel/api.git",
                },
              }
            : {}),
          credentials: {
            github: [
              {
                repositories: ["vercel/api"],
                actions: ["git:read", "github:issues:read"],
              },
            ],
          },
        }),
      ).toThrow(/credentials.github.0.actions.0/);
    },
  );

  test("rejects any unsupported action even when a caller bypasses parsing", () => {
    const config = parseConfig({
      credentials: {
        github: [
          { repositories: ["vercel/api"], actions: ["github:issues:read"] },
        ],
      },
    });
    config.credentials.github[0].actions.push("git:admin" as never);
    expect(() => toTransport(config)).toThrow(/credentials.github.0.actions.1/);
  });

  test.each([
    "https://user:unsafe-secret@github.com/vercel/api.git",
    "https://github.com/vercel/api.git?token=unsafe-secret",
    "https://github.com/vercel/api.git#unsafe-secret",
  ])("rejects unsafe source URLs even when parsing was bypassed", (url) => {
    const config = parseConfig({
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: { github: [] },
    });
    config.source!.url = url;
    let caught: unknown;
    try {
      toTransport(config);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("unsafe-secret");
    expect(JSON.stringify(caught)).not.toContain("unsafe-secret");
  });

  test("allows Git access for repositories other than the source", () => {
    const transport = transportFor({
      source: { type: "git", url: "https://github.com/vercel/source.git" },
      credentials: {
        github: [
          { repositories: ["vercel/api"], actions: ["git:write"] },
          { repositories: ["vercel/front"], actions: ["github:issues:read"] },
        ],
      },
    });
    expect(transport.credentials?.github).toEqual([
      { repositories: ["vercel/api"], actions: ["git:write"] },
      { repositories: ["vercel/front"], actions: ["github:issues:read"] },
    ]);
  });
});

describe("explicit legacy commit metadata", () => {
  const commitAs = { name: "Ada", email: "ada@example.com" };

  test.each([
    {
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: { github: [] },
    },
    {
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: {
        github: [
          {
            repositories: ["vercel/api", "vercel/other"],
            actions: ["git:write"],
          },
        ],
      },
    },
    {
      credentials: {
        github: [{ repositories: ["vercel/api"], actions: ["git:write"] }],
      },
    },
    {
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: {
        github: [{ repositories: ["vercel/other"], actions: ["git:write"] }],
      },
    },
    {
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: {
        github: [
          { repositories: ["vercel/api"], actions: ["git:write"] },
          { repositories: ["vercel/other"], actions: ["git:write-workflows"] },
        ],
      },
    },
    {
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: {
        github: [
          { repositories: ["vercel/api"], actions: ["git:write"] },
          { repositories: ["vercel/other"], actions: ["git:write"] },
        ],
      },
    },
    {
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: {
        github: [
          { repositories: ["vercel/api"], actions: ["git:write-workflows"] },
        ],
      },
    },
  ])(
    "rejects overrides that cannot preserve exact permissions: %j",
    (config) => {
      expect(() => transportFor({ ...config, commitAs })).toThrow(/commitAs/);
    },
  );

  test("retains explicit commit metadata for a sole writing source with workflows and unrelated API groups", () => {
    const transport = transportFor({
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      commitAs,
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["git:write-workflows", "git:write"],
            actAs: "42",
          },
          {
            repositories: ["vercel/reference"],
            actions: ["github:issues:read"],
            actAs: "43",
          },
        ],
      },
    });
    expect(transport.commitAs).toEqual(commitAs);
    expect(transport.credentials?.github[0]).toEqual({
      repositories: ["vercel/api"],
      actions: ["git:write-workflows", "git:write"],
      actAs: "42",
    });
  });
});
