import { describe, expect, test, vi } from "vitest";
import { GITHUB_API_CREDENTIAL_ACTIONS } from "@vercel/sandbox";
import {
  parseActions,
  resolveManagedCredentials,
} from "../../src/util/managed-credentials-resolve";
import { parseConfig } from "../../src/util/managed-credentials-config";
import { toTransport } from "../../src/util/managed-credentials-transport";
import { renderManagedCredentialsRetryCommand } from "../../src/util/managed-credentials-retry-command";
import { buildReview } from "../../src/util/managed-credentials-review";
import { toConfig } from "../../src/util/managed-credentials-reuse";
import { calculateMissingBounds } from "../../src/util/managed-credentials-bounds";

function context() {
  return {
    token: "test-token",
    inferRepositoryImpl: vi.fn(async () => "acme/widgets"),
    inferActorImpl: vi.fn(async () => ({
      actAs: "42",
      login: "octocat",
      source: "gh" as const,
    })),
    inferCommitIdentityImpl: vi.fn(async () => ({
      name: "Local Git Name",
      email: "local@example.com",
    })),
  };
}

describe("unified credential actions", () => {
  test.each([
    "git:write",
    "git:write-workflows",
    ...GITHUB_API_CREDENTIAL_ACTIONS,
  ])(
    "accepts supported action %s without a Git-specific rejection",
    (action) => {
      expect(parseActions([action])).toEqual([action]);
    },
  );

  test("rejects actions outside the Sandbox create API registry", () => {
    expect(() => parseActions(["git:read"])).toThrow(/Unsupported/);
    expect(() => parseActions(["github:made-up:write"])).toThrow(/Unsupported/);
  });

  test.each([
    ["git:write", "github:pull-request:create"],
    ["git:write-workflows"],
    ["github:issues:read"],
  ])(
    "explicit actions replace the whole set without inference or implicit Git access: %j",
    async (...actions) => {
      const ctx = context();
      const result = await resolveManagedCredentials(
        { credentialsActions: actions },
        ctx,
      );
      expect(result?.config.credentials.github[0]).toEqual({
        repositories: ["acme/widgets"],
        actions,
        actAs: "42",
      });
      expect(result?.config).not.toHaveProperty("commitAs");
      expect(ctx.inferCommitIdentityImpl).not.toHaveBeenCalled();
      expect(result?.provenance.actions).toBe("explicit");
    },
  );

  test("supported groups travel in credentials.github, including Git-only groups without a clone source", () => {
    const config = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["git:write"],
            actAs: "42",
          },
          {
            repositories: ["acme/tools"],
            actions: ["git:write-workflows", "github:issues:read"],
            actAs: "43",
          },
        ],
      },
    });
    expect(toTransport(config)).toEqual({
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["git:write"],
            actAs: "42",
          },
          {
            repositories: ["acme/tools"],
            actions: ["git:write-workflows", "github:issues:read"],
            actAs: "43",
          },
        ],
      },
    });
  });

  test("clone source is plain and grants do not acquire additional actions", async () => {
    const result = await resolveManagedCredentials(
      { credentialsActions: ["git:write", "github:pull-request:create"] },
      context(),
    );
    const wire = toTransport(result!.config);
    expect(wire.source).toEqual({
      type: "git",
      url: "https://github.com/acme/widgets.git",
    });
    expect(wire.credentials?.github[0].actions).toEqual([
      "git:write",
      "github:pull-request:create",
    ]);
    expect(wire).not.toHaveProperty("commitAs");
  });

  test("rejection recovery prints every selected action without relying on Git defaults", () => {
    const config = parseConfig({
      source: { type: "git", url: "https://github.com/acme/widgets.git" },
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["git:write-workflows", "github:pull-request:create"],
            actAs: "42",
          },
        ],
      },
    });
    const command = renderManagedCredentialsRetryCommand({
      config,
      team: "team",
      project: "project",
      vcpus: 6,
    });
    expect(command).toContain(
      "--credentials-github-action=git:write-workflows",
    );
    expect(command).toContain(
      "--credentials-github-action=github:pull-request:create",
    );
    expect(command).not.toContain("--credentials-github-action=git:write ");
    expect(command).not.toContain("--credentials-github-commit-as");
  });

  test("review shows Git-only repository permissions and their selected actor", () => {
    const config = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["git:write"],
            actAs: "42",
          },
        ],
      },
    });
    const rows = buildReview({
      config,
      originLabel: "flags",
      provenance: { actions: "explicit", actor: "gh" },
      actor: { actAs: "42", login: "octocat", source: "gh" },
      team: "team",
      project: "project",
      vcpus: 6,
      vcpusExplicit: false,
      missingBounds: [],
    });
    expect(rows.find((row) => row.label === "Access acme/widgets")?.value).toBe(
      "git:write",
    );
    expect(rows.find((row) => row.label === "GitHub actor")?.value).toBe(
      "@octocat",
    );
    expect(rows.find((row) => row.label === "Commit credit")?.value).not.toBe(
      "none",
    );
  });

  test("workflow permission covers ordinary Git writes but ordinary writes never imply workflow permission", () => {
    const config = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["git:write"],
            actAs: "42",
          },
        ],
      },
    });
    expect(
      calculateMissingBounds(config, {
        status: "known",
        bounds: [{ repo: "acme/widgets", actions: ["git:write-workflows"] }],
      }),
    ).toEqual([]);
    config.credentials.github[0].actions = ["git:write-workflows"];
    expect(
      calculateMissingBounds(config, {
        status: "known",
        bounds: [{ repo: "acme/widgets", actions: ["git:write"] }],
      }),
    ).toEqual([{ repo: "acme/widgets", actions: ["git:write-workflows"] }]);
  });

  test("modern snapshot reuse never expands workflow-only permission or replays derived legacy attribution", () => {
    const result = parseConfig(
      toConfig(
        {
          source: {
            type: "git",
            url: "https://github.com/acme/widgets.git",
            credentials: true,
          },
          commitAs: {
            name: "Derived GitHub Name",
            email: "derived@example.com",
          },
          credentials: {
            github: [
              {
                repositories: ["acme/widgets"],
                actions: ["git:write-workflows"],
                actAs: "42",
              },
            ],
          },
        },
        "existing",
      ),
    );
    expect(result.credentials.github[0].actions).toEqual([
      "git:write-workflows",
    ]);
    expect(result).not.toHaveProperty("commitAs");
  });
});
