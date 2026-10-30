import { describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hasManagedCredentialsRequest,
  invalidatedBy,
  parseActions,
  resolveManagedCredentials,
  type ManagedCredentialsOptions,
} from "../../src/util/managed-credentials-resolve";
import { CliError } from "../../src/util/cli-error";

const options = (
  overrides: Partial<ManagedCredentialsOptions> = {},
): ManagedCredentialsOptions => ({ credentialsActions: [], ...overrides });

const context = (overrides: Record<string, unknown> = {}) => ({
  token: "test-token",
  teamId: "team_123",
  inferRepositoryImpl: vi.fn().mockResolvedValue("vercel/api"),
  inferCommitIdentityImpl: vi
    .fn()
    .mockResolvedValue({ name: "Jack Jackson", email: "scubbojj@gmail.com" }),
  inferActorImpl: vi
    .fn()
    .mockResolvedValue({ actAs: "@scubbo", login: "scubbo", source: "gh" }),
  ...overrides,
});

describe("request detection", () => {
  test("a bare create requests nothing", () => {
    expect(hasManagedCredentialsRequest(options())).toBe(false);
  });

  test("the enable flag requests managed credentials", () => {
    expect(
      hasManagedCredentialsRequest(options({ enableManagedCredentials: true })),
    ).toBe(true);
  });

  test.each([
    ["credentialsRepo", { credentialsRepo: "acme/widgets" }],
    ["credentialsAction", { credentialsActions: ["issues:read"] }],
    ["credentialsCommitAs", { credentialsCommitAs: "A <a@example.com>" }],
    ["credentialsActAs", { credentialsActAs: "scubbo" }],
    ["credentialsNoWrite", { credentialsNoWrite: true }],
    ["credentialsFromConfigFile", { credentialsFromConfigFile: "x.json" }],
    ["credentialsFromSandbox", { credentialsFromSandbox: "sbx_1" }],
  ])("%s activates without a separate enable flag", (_name, overrides) => {
    expect(hasManagedCredentialsRequest(options(overrides))).toBe(true);
  });

  test("persisting alone does not request managed credentials", () => {
    // It only says where to write a configuration, not that one is wanted.
    expect(
      hasManagedCredentialsRequest(
        options({ credentialsPersistConfiguration: "" }),
      ),
    ).toBe(false);
  });
});

describe("inferred single-repository defaults", () => {
  test("infers the repository, source, identity, and default actions", async () => {
    const resolved = await resolveManagedCredentials(
      options({ enableManagedCredentials: true }),
      context(),
    );
    expect(resolved?.config).toEqual({
      source: { repo: "vercel/api" },
      commitAs: { name: "Jack Jackson", email: "scubbojj@gmail.com" },
      credentials: {
        github: [
          {
            repo: "vercel/api",
            actions: [
              "github:issues:read",
              "github:issues:comment",
              "github:pull-request:create",
              "git:write",
            ],
            actAs: "@scubbo",
          },
        ],
      },
    });
    expect(resolved?.provenance).toEqual({
      repository: "git-remote",
      commitAs: "git-config",
      actor: "gh",
    });
  });

  test("supplied actions replace the defaults rather than adding to them", async () => {
    const resolved = await resolveManagedCredentials(
      options({ credentialsActions: ["issues:read", "issues:comment"] }),
      context(),
    );
    expect(resolved?.config.credentials.github[0].actions).toEqual([
      "github:issues:read",
      "github:issues:comment",
      "git:write",
    ]);
  });

  test("Git write stays the default even when actions are overridden", async () => {
    const resolved = await resolveManagedCredentials(
      options({ credentialsActions: ["labels:read"] }),
      context(),
    );
    expect(resolved?.config.credentials.github[0].actions).toContain(
      "git:write",
    );
  });

  test("an explicit repository overrides the inferred one", async () => {
    const inferRepositoryImpl = vi.fn();
    const resolved = await resolveManagedCredentials(
      options({ credentialsRepo: "acme/widgets" }),
      context({ inferRepositoryImpl }),
    );
    expect(resolved?.config.source).toEqual({ repo: "acme/widgets" });
    expect(resolved?.config.credentials.github[0].repo).toBe("acme/widgets");
    expect(inferRepositoryImpl).not.toHaveBeenCalled();
  });

  test("rejects a malformed explicit repository", async () => {
    await expect(
      resolveManagedCredentials(
        options({ credentialsRepo: "not-a-repo" }),
        context(),
      ),
    ).rejects.toThrow(/OWNER\/REPOSITORY/);
  });

  test("reports a missing repository instead of guessing", async () => {
    await expect(
      resolveManagedCredentials(
        options({ enableManagedCredentials: true }),
        context({ inferRepositoryImpl: vi.fn().mockResolvedValue(undefined) }),
      ),
    ).rejects.toThrow(/Can't infer the repository/);
  });

  test("does not request workflow write access by default", async () => {
    const resolved = await resolveManagedCredentials(
      options({ enableManagedCredentials: true }),
      context(),
    );
    const actions = resolved?.config.credentials.github[0].actions ?? [];
    expect(actions.some((action) => action.includes("workflow"))).toBe(false);
  });
});

describe("--credentials-no-write", () => {
  test("downgrades Git write to read without touching API actions", async () => {
    const resolved = await resolveManagedCredentials(
      options({
        credentialsNoWrite: true,
        credentialsActions: ["issues:comment"],
      }),
      context(),
    );
    expect(resolved?.config.credentials.github[0].actions).toEqual([
      "github:issues:comment",
      "git:read",
    ]);
  });

  test("keeps the full default API action set", async () => {
    const resolved = await resolveManagedCredentials(
      options({ enableManagedCredentials: true, credentialsNoWrite: true }),
      context(),
    );
    expect(resolved?.config.credentials.github[0].actions).toEqual([
      "github:issues:read",
      "github:issues:comment",
      "github:pull-request:create",
      "git:read",
    ]);
  });

  test("omits the inferred commit identity", async () => {
    const inferCommitIdentityImpl = vi.fn();
    const resolved = await resolveManagedCredentials(
      options({ credentialsNoWrite: true }),
      context({ inferCommitIdentityImpl }),
    );
    expect(resolved?.config.commitAs).toBeUndefined();
    expect(resolved?.provenance.commitAs).toBe("omitted");
    expect(inferCommitIdentityImpl).not.toHaveBeenCalled();
  });

  test("rejects a commit identity that could not take effect", async () => {
    await expect(
      resolveManagedCredentials(
        options({
          credentialsNoWrite: true,
          credentialsCommitAs: "Ada <ada@example.com>",
        }),
        context(),
      ),
    ).rejects.toThrow(/no effect with --credentials-no-write/);
  });
});

describe("identity resolution", () => {
  test("an explicit commit identity overrides local Git configuration", async () => {
    const inferCommitIdentityImpl = vi.fn();
    const resolved = await resolveManagedCredentials(
      options({
        credentialsCommitAs: "Jack Jackson <myotheremail@scubbo.org>",
      }),
      context({ inferCommitIdentityImpl }),
    );
    expect(resolved?.config.commitAs).toEqual({
      name: "Jack Jackson",
      email: "myotheremail@scubbo.org",
    });
    expect(inferCommitIdentityImpl).not.toHaveBeenCalled();
  });

  test("falls back to connected profile metadata when Git has no identity", async () => {
    // Mirrors the server-side resolveGitIdentity fallback: profile name, then
    // the GitHub noreply address built from the numeric ID and login.
    const resolved = await resolveManagedCredentials(
      options({ enableManagedCredentials: true }),
      context({
        inferCommitIdentityImpl: vi.fn().mockResolvedValue(undefined),
        inferActorImpl: vi.fn().mockResolvedValue({
          actAs: "2373726",
          login: "scubbo",
          source: "gh",
          profile: {
            name: "Jack Jackson",
            login: "scubbo",
            id: "2373726",
            email: "ignored@example.com",
          },
        }),
      }),
    );
    expect(resolved?.config.commitAs).toEqual({
      name: "Jack Jackson",
      email: "2373726+scubbo@users.noreply.github.com",
    });
    expect(resolved?.provenance.commitAs).toBe("profile-fallback");
  });

  test("prefers the local Git identity over the profile fallback", async () => {
    const resolved = await resolveManagedCredentials(
      options({ enableManagedCredentials: true }),
      context({
        inferActorImpl: vi.fn().mockResolvedValue({
          actAs: "2373726",
          source: "gh",
          profile: { name: "Profile Name", login: "scubbo", id: "2373726" },
        }),
      }),
    );
    expect(resolved?.config.commitAs).toEqual({
      name: "Jack Jackson",
      email: "scubbojj@gmail.com",
    });
    expect(resolved?.provenance.commitAs).toBe("git-config");
  });

  test("requires a commit identity when neither Git nor a profile supplies one", async () => {
    await expect(
      resolveManagedCredentials(
        options({ enableManagedCredentials: true }),
        context({
          inferCommitIdentityImpl: vi.fn().mockResolvedValue(undefined),
        }),
      ),
    ).rejects.toThrow(/Can't infer a commit identity/);
  });

  test("does not fabricate an identity from partial profile metadata", async () => {
    await expect(
      resolveManagedCredentials(
        options({ enableManagedCredentials: true }),
        context({
          inferCommitIdentityImpl: vi.fn().mockResolvedValue(undefined),
          inferActorImpl: vi.fn().mockResolvedValue({
            actAs: "@scubbo",
            source: "gh",
            // A login with no ID and no email cannot produce an address.
            profile: { login: "scubbo" },
          }),
        }),
      ),
    ).rejects.toThrow(/Can't infer a commit identity/);
  });

  test("requires an actor when API actions are requested", async () => {
    await expect(
      resolveManagedCredentials(
        options({ enableManagedCredentials: true }),
        context({ inferActorImpl: vi.fn().mockResolvedValue(undefined) }),
      ),
    ).rejects.toThrow(/Can't resolve the GitHub account/);
  });

  test("passes an explicit actor through to inference", async () => {
    const inferActorImpl = vi.fn().mockResolvedValue({
      actAs: "123456",
      source: "explicit",
    });
    const resolved = await resolveManagedCredentials(
      options({ credentialsActAs: "123456" }),
      context({ inferActorImpl }),
    );
    expect(inferActorImpl).toHaveBeenCalledWith(
      expect.objectContaining({ explicit: "123456" }),
    );
    expect(resolved?.config.credentials.github[0].actAs).toBe("123456");
  });
});

describe("--credentials-action validation", () => {
  test("rejects comma-separated lists", () => {
    expect(() => parseActions(["issues:read,issues:comment"])).toThrow(
      /one action per flag/,
    );
  });

  test("rejects duplicates", () => {
    expect(() => parseActions(["issues:read", "issues:read"])).toThrow(
      /Duplicate/,
    );
  });

  test("rejects unknown actions", () => {
    expect(() => parseActions(["issues:delete"])).toThrow(/Unsupported/);
  });

  test("points Git actions at --credentials-no-write", () => {
    expect(() => parseActions(["git:read"])).toThrow(/--credentials-no-write/);
  });
});

describe("explicit configuration sources", () => {
  let directory: string;

  const withTempFile = async (contents: string) => {
    directory = await mkdtemp(join(tmpdir(), "managed-credentials-"));
    const path = join(directory, "config.json");
    await writeFile(path, contents, "utf8");
    return path;
  };

  test("rejects a group with no actions instead of filling in defaults", async () => {
    // A group must say what it wants. Granting nothing is expressed with an
    // empty `github` array, not with an empty `actions` list.
    const path = await withTempFile(
      JSON.stringify({
        credentials: { github: [{ repo: "acme/widgets", actions: [] }] },
      }),
    );
    try {
      await expect(
        resolveManagedCredentials(
          options({ credentialsFromConfigFile: path }),
          context(),
        ),
      ).rejects.toThrow(CliError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("an empty github array acquires no default actions", async () => {
    const path = await withTempFile(
      JSON.stringify({ credentials: { github: [] } }),
    );
    try {
      const resolved = await resolveManagedCredentials(
        options({ credentialsFromConfigFile: path }),
        context(),
      );
      expect(resolved?.config.credentials.github).toEqual([]);
      expect(resolved?.origin).toBe("file");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("preserves explicit per-repository mappings", async () => {
    const path = await withTempFile(
      JSON.stringify({
        source: { repo: "vercel/infra" },
        credentials: {
          github: [
            { repo: "vercel/infra", actions: ["git:read"], actAs: "@alias" },
            { repo: "vercel/front", actions: ["issues:read"], actAs: 123456 },
          ],
        },
      }),
    );
    try {
      const resolved = await resolveManagedCredentials(
        options({ credentialsFromConfigFile: path }),
        context(),
      );
      expect(resolved?.config.credentials.github).toEqual([
        { repo: "vercel/infra", actions: ["git:read"], actAs: "@alias" },
        {
          repo: "vercel/front",
          actions: ["github:issues:read"],
          actAs: "123456",
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reuses a configuration from another sandbox", async () => {
    const loadFromSandbox = vi.fn().mockResolvedValue({
      source: { repo: "acme/widgets" },
      credentials: {
        github: [{ repo: "acme/widgets", actions: ["github:issues:read"] }],
      },
    });
    const resolved = await resolveManagedCredentials(
      options({ credentialsFromSandbox: "sbx_123" }),
      context({ loadFromSandbox }),
    );
    expect(loadFromSandbox).toHaveBeenCalledWith("sbx_123");
    expect(resolved?.origin).toBe("sandbox");
    expect(resolved?.originLabel).toContain("sbx_123");
  });
});

describe("conflicting inputs", () => {
  test("rejects a file combined with another sandbox", async () => {
    await expect(
      resolveManagedCredentials(
        options({
          credentialsFromConfigFile: "a.json",
          credentialsFromSandbox: "sbx_1",
        }),
        context(),
      ),
    ).rejects.toThrow(/both supply a complete configuration/);
  });

  test.each([
    ["credentialsRepo", { credentialsRepo: "acme/widgets" }],
    ["credentialsActions", { credentialsActions: ["issues:read"] }],
    ["credentialsNoWrite", { credentialsNoWrite: true }],
  ])("rejects a file combined with %s", async (_name, overrides) => {
    await expect(
      resolveManagedCredentials(
        options({ credentialsFromConfigFile: "a.json", ...overrides }),
        context(),
      ),
    ).rejects.toThrow(/cannot be combined with/);
  });

  test("rejects the enable flag combined with an explicit configuration", async () => {
    await expect(
      resolveManagedCredentials(
        options({
          credentialsFromConfigFile: "a.json",
          enableManagedCredentials: true,
        }),
        context(),
      ),
    ).rejects.toThrow(/would contradict/);
  });

  test("rejects an empty configuration path", async () => {
    await expect(
      resolveManagedCredentials(
        options({ credentialsFromConfigFile: "" }),
        context(),
      ),
    ).rejects.toThrow(/requires a file path/);
  });
});

describe("dependency invalidation", () => {
  test("editing the repository invalidates the inferred commit identity", () => {
    expect(invalidatedBy("repository")).toContain("commitAs");
  });

  test("editing the team invalidates the project and actor", () => {
    expect(invalidatedBy("team")).toEqual(
      expect.arrayContaining(["project", "actAs"]),
    );
  });

  test("editing an action set invalidates nothing else", () => {
    expect(invalidatedBy("actions")).toEqual([]);
  });
});
