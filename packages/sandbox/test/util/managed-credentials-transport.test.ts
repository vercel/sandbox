import { describe, expect, test } from "vitest";
import { parseConfig } from "../../src/util/managed-credentials-config";
import { toTransport } from "../../src/util/managed-credentials-transport";

const transportFor = (value: unknown) => toTransport(parseConfig(value));

describe("source mapping", () => {
  test("requests managed Git write for a git:write source", () => {
    const transport = transportFor({
      source: { repo: "vercel/api" },
      commitAs: { name: "Ada", email: "ada@example.com" },
      credentials: {
        github: [{ repo: "vercel/api", actions: ["issues:read", "git:write"] }],
      },
    });
    expect(transport.source).toEqual({
      type: "git",
      url: "https://github.com/vercel/api.git",
      credentials: true,
    });
    expect(transport.commitAs).toEqual({
      name: "Ada",
      email: "ada@example.com",
    });
  });

  test("requests a read-only clone for a git:read source", () => {
    const transport = transportFor({
      source: { repo: "vercel/api" },
      credentials: {
        github: [{ repo: "vercel/api", actions: ["issues:read", "git:read"] }],
      },
    });
    expect(transport.source).toEqual({
      type: "git",
      url: "https://github.com/vercel/api.git",
      credentials: "read",
    });
  });

  test("omits inert commit metadata so it cannot upgrade a read-only source", () => {
    // The product specification's "Maximal" example carries commitAs while the
    // source holds only git:read. Forwarding it would let source handling infer
    // write access that was never requested.
    const transport = transportFor({
      source: { repo: "vercel/infra" },
      commitAs: { name: "John Fakenameson", email: "madeup@example.org" },
      credentials: {
        github: [{ repo: "vercel/infra", actions: ["git:read"] }],
      },
    });
    expect(transport.source?.credentials).toBe("read");
    expect(transport.commitAs).toBeUndefined();
  });

  test("carries revision and depth through unchanged", () => {
    const transport = transportFor({
      source: { repo: "vercel/api", revision: "main", depth: 1 },
      credentials: {
        github: [{ repo: "vercel/api", actions: ["git:read"] }],
      },
    });
    expect(transport.source).toMatchObject({ revision: "main", depth: 1 });
  });

  test("omits source credentials when no Git access was requested", () => {
    const transport = transportFor({
      source: { repo: "vercel/api" },
      credentials: {
        github: [{ repo: "vercel/api", actions: ["issues:read"] }],
      },
    });
    expect(transport.source).toEqual({
      type: "git",
      url: "https://github.com/vercel/api.git",
    });
  });
});

describe("credential groups", () => {
  test("sends only GitHub API actions in group actions", () => {
    const transport = transportFor({
      source: { repo: "vercel/api" },
      credentials: {
        github: [
          {
            repo: "vercel/api",
            actions: ["issues:read", "git:write"],
            actAs: "@scubbo",
          },
        ],
      },
    });
    expect(transport.credentials).toEqual({
      github: [
        {
          repositories: ["vercel/api"],
          actions: ["github:issues:read"],
          actAs: "@scubbo",
        },
      ],
    });
  });

  test("collapses repositories that share an action set and identity", () => {
    const transport = transportFor({
      credentials: {
        github: [
          { repo: "acme/one", actions: ["issues:read"], actAs: "42" },
          { repo: "acme/two", actions: ["issues:read"], actAs: "42" },
        ],
      },
    });
    expect(transport.credentials?.github).toEqual([
      {
        repositories: ["acme/one", "acme/two"],
        actions: ["github:issues:read"],
        actAs: "42",
      },
    ]);
  });

  test("keeps differing action sets and identities in separate groups", () => {
    const transport = transportFor({
      credentials: {
        github: [
          { repo: "acme/one", actions: ["issues:read"], actAs: "42" },
          { repo: "acme/two", actions: ["issues:read"], actAs: "43" },
          { repo: "acme/three", actions: ["pull-request:create"], actAs: "42" },
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

  test("drops a group that requests only Git access from the API groups", () => {
    const transport = transportFor({
      source: { repo: "vercel/api" },
      credentials: {
        github: [{ repo: "vercel/api", actions: ["git:read"] }],
      },
    });
    expect(transport.credentials).toEqual({ github: [] });
    expect(transport.source?.credentials).toBe("read");
  });
});

describe("unrealizable requests", () => {
  test("rejects Git access for a repository that is not the source", () => {
    expect(() =>
      transportFor({
        source: { repo: "vercel/api" },
        credentials: {
          github: [{ repo: "vercel/front", actions: ["git:write"] }],
        },
      }),
    ).toThrow(/only available for the Sandbox source/);
  });

  test("rejects Git access when there is no source at all", () => {
    expect(() =>
      transportFor({
        credentials: {
          github: [{ repo: "vercel/api", actions: ["git:read"] }],
        },
      }),
    ).toThrow(/only available for the Sandbox source/);
  });

  test("allows API access for repositories other than the source", () => {
    const transport = transportFor({
      source: { repo: "vercel/api" },
      credentials: {
        github: [
          { repo: "vercel/api", actions: ["git:write"] },
          { repo: "vercel/front", actions: ["issues:read"] },
        ],
      },
    });
    expect(transport.credentials?.github).toEqual([
      { repositories: ["vercel/front"], actions: ["github:issues:read"] },
    ]);
  });
});
