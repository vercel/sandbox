import { describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hasManagedCredentialsRequest,
  parseActions,
  resolveManagedCredentials,
  type ManagedCredentialsOptions,
} from "../../src/util/managed-credentials-resolve";
import { CliError } from "../../src/util/cli-error";

vi.mock(
  "@vercel/sandbox",
  () => import("../../../vercel-sandbox/src/managed-credentials"),
);

const options = (
  overrides: Partial<ManagedCredentialsOptions> = {},
): ManagedCredentialsOptions => ({ credentialsActions: [], ...overrides });

const context = (overrides: Record<string, unknown> = {}) => ({
  token: "test-token",
  teamId: "team_123",
  inferRepositoryImpl: vi.fn().mockResolvedValue("vercel/api"),
  inferActorImpl: vi
    .fn()
    .mockResolvedValue({ actAs: "@scubbo", login: "scubbo", source: "gh" }),
  ...overrides,
});

describe("request detection", () => {
  test("a new invocation selects the actor without deriving local commit credit", async () => {
    const ctx = context({
      inferActorImpl: vi
        .fn()
        .mockResolvedValueOnce({
          actAs: "1",
          source: "gh",
          profile: { name: "One", login: "one", id: "1" },
        })
        .mockResolvedValueOnce({
          actAs: "2",
          source: "gh",
          profile: { name: "Two", login: "two", id: "2" },
        }),
    });
    const first = await resolveManagedCredentials(
      options({ enableManagedCredentials: true }),
      ctx,
    );
    const next = await resolveManagedCredentials(
      options({ enableManagedCredentials: true, credentialsActAs: "2" }),
      ctx,
    );
    expect(first?.config.credentials.github[0].actAs).toBe("1");
    expect(next?.config.credentials.github[0].actAs).toBe("2");
    expect(first?.config.commitAs).toBeUndefined();
    expect(next?.config.commitAs).toBeUndefined();
  });
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
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
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
      commitAs: "actor-derived",
      actor: "gh",
      actions: "default",
      gitAccess: "default",
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
    ]);
  });

  test("explicit API actions acquire no implicit Git access", async () => {
    const resolved = await resolveManagedCredentials(
      options({ credentialsActions: ["labels:read"] }),
      context(),
    );
    expect(resolved?.config.credentials.github[0].actions).toEqual([
      "github:labels:read",
    ]);
  });

  test("an explicit repository overrides the inferred one", async () => {
    const inferRepositoryImpl = vi.fn();
    const resolved = await resolveManagedCredentials(
      options({ credentialsRepo: "acme/widgets" }),
      context({ inferRepositoryImpl }),
    );
    expect(resolved?.config.source).toEqual({
      type: "git",
      url: "https://github.com/acme/widgets.git",
    });
    expect(resolved?.config.credentials.github[0].repositories).toEqual([
      "acme/widgets",
    ]);
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

describe("legacy read-only Git option", () => {
  test("rejects unsupported read intent before inference instead of upgrading it", async () => {
    const ctx = context();
    await expect(
      resolveManagedCredentials(options({ credentialsNoWrite: true }), ctx),
    ).rejects.toThrow(/does not support/);
    expect(ctx.inferRepositoryImpl).not.toHaveBeenCalled();
    expect(ctx.inferActorImpl).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    "does not combine a separate Git toggle with an exact action set (%s)",
    async (credentialsNoWrite) => {
      await expect(
        resolveManagedCredentials(
          options({
            credentialsNoWrite,
            credentialsActions: ["issues:comment"],
          }),
          context(),
        ),
      ).rejects.toThrow(/complete action set/);
    },
  );
});

describe("identity resolution", () => {
  test("an explicit commit identity is the only source of commit credit", async () => {
    const resolved = await resolveManagedCredentials(
      options({
        credentialsCommitAs: "Jack Jackson <myotheremail@scubbo.org>",
      }),
      context(),
    );
    expect(resolved?.config.commitAs).toEqual({
      name: "Jack Jackson",
      email: "myotheremail@scubbo.org",
    });
  });

  test("leaves profile-derived commit attribution to the backend", async () => {
    const resolved = await resolveManagedCredentials(
      options({ enableManagedCredentials: true }),
      context({
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
    expect(resolved?.config.commitAs).toBeUndefined();
    expect(resolved?.provenance.commitAs).toBe("actor-derived");
  });

  test("does not substitute a local Git identity for the selected actor", async () => {
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
    expect(resolved?.config.commitAs).toBeUndefined();
    expect(resolved?.provenance.commitAs).toBe("actor-derived");
  });

  test("does not require local commit metadata when an actor is selected", async () => {
    const result = await resolveManagedCredentials(
      options({ enableManagedCredentials: true }),
      context({}),
    );
    expect(result?.config.commitAs).toBeUndefined();
    expect(result?.config.credentials.github[0].actAs).toBe("@scubbo");
  });

  test("keeps partial profile metadata out of commitAs", async () => {
    const result = await resolveManagedCredentials(
      options({ enableManagedCredentials: true }),
      context({
        inferActorImpl: vi.fn().mockResolvedValue({
          actAs: "@scubbo",
          source: "gh",
          profile: { login: "scubbo" },
        }),
      }),
    );
    expect(result?.config.commitAs).toBeUndefined();
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

describe("--credentials-github-action validation", () => {
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

  test("rejects unsupported create actions without redirecting legitimate Git writes", () => {
    expect(() => parseActions(["git:read"])).toThrow(/Unsupported/);
    expect(parseActions(["git:write", "git:write-workflows"])).toEqual([
      "git:write",
      "git:write-workflows",
    ]);
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
        credentials: {
          github: [{ repositories: ["acme/widgets"], actions: [] }],
        },
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

  test("accepts an API-shaped file and preserves complete repository groups exactly", async () => {
    const document = {
      source: {
        depth: 2,
        url: "https://github.com/vercel/infra/",
        type: "git",
        revision: "topic/branch",
      },
      credentials: {
        github: [
          {
            repositories: ["vercel/infra", "vercel/shared"],
            actions: ["git:write", "github:issues:read"],
            actAs: "@alias",
          },
          {
            repositories: ["vercel/front"],
            actions: ["github:issues:read"],
            actAs: "123456",
          },
          {
            repositories: ["vercel/docs", "vercel/infra"],
            actions: ["github:issues:read"],
            actAs: "@alias",
          },
        ],
      },
    };
    const path = await withTempFile(JSON.stringify(document));
    const ctx = context();
    try {
      const resolved = await resolveManagedCredentials(
        options({ credentialsFromConfigFile: path }),
        ctx,
      );
      expect(resolved?.config).toEqual(document);
      expect(resolved?.origin).toBe("file");
      expect(Object.keys(resolved!.config.source!)).toEqual(
        Object.keys(document.source),
      );
      expect(ctx.inferRepositoryImpl).not.toHaveBeenCalled();
      expect(ctx.inferActorImpl).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test.each([
    { source: { repo: "acme/widgets" }, credentials: { github: [] } },
    {
      credentials: {
        github: [{ repo: "acme/widgets", actions: ["github:issues:read"] }],
      },
    },
    {
      credentials: {
        github: [{ repositories: ["acme/widgets"], actions: ["issues:read"] }],
      },
    },
    {
      credentials: {
        github: [
          { repositories: ["acme/widgets"], actions: ["git:write"], actAs: 42 },
        ],
      },
    },
  ])(
    "rejects old logical shapes and file aliases without inference: %j",
    async (document) => {
      const path = await withTempFile(JSON.stringify(document));
      const ctx = context();
      try {
        await expect(
          resolveManagedCredentials(
            options({ credentialsFromConfigFile: path }),
            ctx,
          ),
        ).rejects.toThrow(CliError);
        expect(ctx.inferRepositoryImpl).not.toHaveBeenCalled();
        expect(ctx.inferActorImpl).not.toHaveBeenCalled();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  test("reuses a configuration from another sandbox", async () => {
    const loadFromSandbox = vi.fn().mockResolvedValue({
      source: { type: "git", url: "https://github.com/acme/widgets.git" },
      credentials: {
        github: [
          {
            repositories: ["acme/widgets", "acme/other"],
            actions: ["github:issues:read"],
          },
        ],
      },
    });
    const resolved = await resolveManagedCredentials(
      options({ credentialsFromSandbox: "sbx_123" }),
      context({ loadFromSandbox }),
    );
    expect(loadFromSandbox).toHaveBeenCalledWith("sbx_123");
    expect(resolved?.origin).toBe("sandbox");
    expect(resolved?.originLabel).toContain("sbx_123");
    expect(resolved?.config).toEqual(
      await loadFromSandbox.mock.results[0].value,
    );
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
