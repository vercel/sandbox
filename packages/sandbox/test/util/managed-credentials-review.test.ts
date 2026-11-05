import { describe, expect, test, vi } from "vitest";
import { parseConfig } from "../../src/util/managed-credentials-config";
import {
  buildReview,
  renderReview,
} from "../../src/util/managed-credentials-review";
import { calculateMissingBounds } from "../../src/util/managed-credentials-bounds";
import { CliError } from "../../src/util/cli-error";

const review = (overrides: Record<string, unknown> = {}) =>
  buildReview({
    config: parseConfig({
      source: { type: "git", url: "https://github.com/vercel/api.git" },
      commitAs: { name: "Jack Jackson", email: "scubbojj@gmail.com" },
      credentials: {
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["github:issues:read", "git:write"],
            actAs: "@scubbo",
          },
        ],
      },
    }),
    originLabel: "command-line flags",
    provenance: {
      repository: "git-remote",
      commitAs: "git-config",
      actor: "gh",
    },
    team: "jacks-projects",
    project: "api",
    vcpus: 6,
    vcpusExplicit: false,
    missingBounds: [],
    ...overrides,
  });

const valueOf = (rows: ReturnType<typeof buildReview>, label: string) =>
  rows.find((row) => row.label === label)?.value;

describe("review contents", () => {
  test("associates each repository's API access with its actor", () => {
    const rows = review({
      config: parseConfig({
        credentials: {
          github: [
            {
              repositories: ["one/repo"],
              actions: ["github:issues:read"],
              actAs: "@one",
            },
            {
              repositories: ["two/repo"],
              actions: ["github:issues:comment"],
              actAs: "@two",
            },
          ],
        },
      }),
    });
    expect(valueOf(rows, "GitHub actor one/repo")).toBe("@one");
    expect(valueOf(rows, "GitHub actor two/repo")).toBe("@two");
  });
  test("shows team, project, source, access, resources, and origin", () => {
    const rows = review();
    expect(valueOf(rows, "Team")).toBe("jacks-projects");
    expect(valueOf(rows, "Project")).toBe("api");
    expect(valueOf(rows, "Source")).toBe("vercel/api");
    expect(valueOf(rows, "Access vercel/api")).toBe(
      "github:issues:read, git:write",
    );
    expect(valueOf(rows, "Git access")).toBeUndefined();
    expect(valueOf(rows, "Resources")).toBe("6 vCPUs");
    expect(valueOf(rows, "Configuration")).toBeUndefined();
    expect(rows.every((row) => !!row.note)).toBe(true);
  });

  test("keeps commit credit and the GitHub actor as separate fields", () => {
    const rows = review();
    // Git user.name/user.email are metadata, not proof of GitHub identity, so
    // they must never be presented as the same thing as the GitHub actor.
    expect(valueOf(rows, "Commit credit")).toBe(
      "Jack Jackson <scubbojj@gmail.com>",
    );
    expect(valueOf(rows, "GitHub actor")).toBe("@scubbo");
  });

  test("marks the managed-credentials vCPU default as a default", () => {
    expect(review().find((row) => row.label === "Resources")?.note).toMatch(
      /default/,
    );
  });

  test("attributes an explicit vCPU count to the flag", () => {
    const rows = review({ vcpus: 2, vcpusExplicit: true });
    expect(rows.find((row) => row.label === "Resources")?.note).toBe(
      "from --vcpus",
    );
  });

  test("flags commit metadata that cannot take effect", () => {
    const rows = buildReview({
      config: parseConfig({
        source: { type: "git", url: "https://github.com/vercel/infra.git" },
        commitAs: { name: "John Fakenameson", email: "madeup@example.org" },
        credentials: {
          github: [
            { repositories: ["vercel/infra"], actions: ["github:issues:read"] },
          ],
        },
      }),
      originLabel: "configuration file config.json",
      provenance: { repository: "config" },
      team: "t",
      project: "p",
      vcpus: 6,
      vcpusExplicit: false,
      missingBounds: [],
    });
    expect(rows.find((row) => row.label === "Commit credit")?.note).toContain(
      "no effect without Git write access",
    );
    expect(valueOf(rows, "Access vercel/infra")).toBe("github:issues:read");
  });

  test("shows a Git-only list without adding API defaults", () => {
    const rows = buildReview({
      config: parseConfig({
        source: { type: "git", url: "https://github.com/vercel/api.git" },
        credentials: {
          github: [{ repositories: ["vercel/api"], actions: ["git:write"] }],
        },
      }),
      originLabel: "configuration file config.json",
      provenance: { repository: "config" },
      team: "t",
      project: "p",
      vcpus: 6,
      vcpusExplicit: false,
      missingBounds: [],
    });
    expect(valueOf(rows, "Access vercel/api")).toBe("git:write");
    expect(
      rows.find((row) => row.label === "Access vercel/api")?.note,
    ).toContain("configuration file");
  });

  test("lists each repository's access separately", () => {
    const rows = buildReview({
      config: parseConfig({
        credentials: {
          github: [
            { repositories: ["acme/one"], actions: ["github:issues:read"] },
            {
              repositories: ["acme/two"],
              actions: ["github:pull-request:create"],
            },
          ],
        },
      }),
      originLabel: "configuration file config.json",
      provenance: { repository: "config" },
      team: "t",
      project: "p",
      vcpus: 6,
      vcpusExplicit: false,
      missingBounds: [],
    });
    expect(valueOf(rows, "Access acme/one")).toBe("github:issues:read");
    expect(valueOf(rows, "Access acme/two")).toBe("github:pull-request:create");
  });

  test("shows proposed project-wide additions as project-wide", () => {
    const rows = review({
      missingBounds: [{ repo: "vercel/api", actions: ["github:issues:read"] }],
    });
    const addition = rows.find((row) => row.label === "Policy addition");
    expect(addition?.value).toContain("project-wide");
    expect(addition?.note).toMatch(/everyone in the project/);
  });

  test("strips control characters from displayed values", () => {
    const rows = buildReview({
      config: parseConfig({
        source: { type: "git", url: "https://github.com/vercel/api.git" },
        commitAs: { name: "Ada‮Evil", email: "ada@example.com" },
        credentials: {
          github: [{ repositories: ["vercel/api"], actions: ["git:write"] }],
        },
      }),
      originLabel: "flags",
      provenance: {},
      team: "t\u0000eam",
      project: "p",
      vcpus: 6,
      vcpusExplicit: false,
      missingBounds: [],
    });
    expect(valueOf(rows, "Team")).toBe("team");
    expect(valueOf(rows, "Commit credit")).toBe("AdaEvil <ada@example.com>");
  });
});

describe("rendering", () => {
  test("aligns setting, value and provenance columns", () => {
    const text = renderReview([
      { label: "Team", value: "acme" },
      { label: "Git access", value: "git:write", note: "default" },
    ]);
    expect(text).toMatch(/Team\s+acme\s+not specified/);
    expect(text).toMatch(/Git access\s+git:write\s+default/);
    expect(text).not.toContain("└");
  });
});

describe("bounds calculation", () => {
  const config = parseConfig({
    source: { type: "git", url: "https://github.com/vercel/api.git" },
    credentials: {
      github: [
        {
          repositories: ["vercel/api"],
          actions: [
            "github:issues:read",
            "github:pull-request:create",
            "git:write",
          ],
        },
      ],
    },
  });

  test("returns nothing when the ceiling already permits the request", () => {
    expect(
      calculateMissingBounds(config, {
        status: "known",
        bounds: [
          {
            repo: "vercel/api",
            actions: [
              "github:issues:read",
              "github:pull-request:create",
              "git:write",
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  test("returns only the actions that are actually missing", () => {
    expect(
      calculateMissingBounds(config, {
        status: "known",
        bounds: [
          { repo: "vercel/api", actions: ["github:issues:read", "git:write"] },
        ],
      }),
    ).toEqual([
      { repo: "vercel/api", actions: ["github:pull-request:create"] },
    ]);
  });

  test("treats a repository outside configured Bounds as entirely missing", () => {
    expect(
      calculateMissingBounds(config, {
        status: "known",
        bounds: [{ repo: "other/repository", actions: [] }],
      }),
    ).toEqual([
      {
        repo: "vercel/api",
        actions: [
          "github:issues:read",
          "github:pull-request:create",
          "git:write",
        ],
      },
    ]);
  });

  test("refuses to treat an unreadable policy as an empty one", () => {
    // Otherwise a failed lookup would look like "nothing is permitted" and the
    // CLI would ask to add project-wide access it never verified was missing.
    expect(() =>
      calculateMissingBounds(config, {
        status: "unknown",
        reason: "HTTP 503",
      }),
    ).toThrow(CliError);
    expect(() =>
      calculateMissingBounds(config, {
        status: "unknown",
        reason: "HTTP 503",
      }),
    ).toThrow(/does not treat an unreadable policy as empty/);
  });
});
