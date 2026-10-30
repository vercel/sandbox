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
      source: { repo: "vercel/api" },
      commitAs: { name: "Jack Jackson", email: "scubbojj@gmail.com" },
      credentials: {
        github: [
          {
            repo: "vercel/api",
            actions: ["issues:read", "git:write"],
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
            { repo: "one/repo", actions: ["issues:read"], actAs: "@one" },
            { repo: "two/repo", actions: ["issues:comment"], actAs: "@two" },
          ],
        },
      }),
    });
    expect(valueOf(rows, "API actor one/repo")).toBe("@one");
    expect(valueOf(rows, "API actor two/repo")).toBe("@two");
  });
  test("shows team, project, source, access, resources, and origin", () => {
    const rows = review();
    expect(valueOf(rows, "Team")).toBe("jacks-projects");
    expect(valueOf(rows, "Project")).toBe("api");
    expect(valueOf(rows, "Source")).toBe("vercel/api");
    expect(valueOf(rows, "Access vercel/api")).toBe("github:issues:read");
    expect(valueOf(rows, "Git access")).toBe("git:write");
    expect(valueOf(rows, "Resources")).toBe("6 vCPUs");
    expect(valueOf(rows, "Configuration")).toBe("command-line flags");
  });

  test("keeps commit credit and the API actor as separate fields", () => {
    const rows = review();
    // Git user.name/user.email are metadata, not proof of GitHub identity, so
    // they must never be presented as the same thing as the API actor.
    expect(valueOf(rows, "Commit credit")).toBe(
      "Jack Jackson <scubbojj@gmail.com>",
    );
    expect(valueOf(rows, "API actor")).toBe("@scubbo");
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
        source: { repo: "vercel/infra" },
        commitAs: { name: "John Fakenameson", email: "madeup@example.org" },
        credentials: {
          github: [{ repo: "vercel/infra", actions: ["git:read"] }],
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
    expect(rows.find((row) => row.label === "Commit credit")?.note).toBe(
      "no effect without Git write access",
    );
    expect(valueOf(rows, "Git access")).toBe("git:read");
  });

  test("shows an explicitly empty action list as empty", () => {
    const rows = buildReview({
      config: parseConfig({
        source: { repo: "vercel/api" },
        credentials: {
          github: [{ repo: "vercel/api", actions: ["git:read"] }],
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
    expect(rows.find((row) => row.label === "Access vercel/api")?.note).toMatch(
      /defaults are not added/,
    );
  });

  test("lists each repository's access separately", () => {
    const rows = buildReview({
      config: parseConfig({
        credentials: {
          github: [
            { repo: "acme/one", actions: ["issues:read"] },
            { repo: "acme/two", actions: ["pull-request:create"] },
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
        source: { repo: "vercel/api" },
        commitAs: { name: "Ada‮Evil", email: "ada@example.com" },
        credentials: {
          github: [{ repo: "vercel/api", actions: ["git:write"] }],
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
  test("aligns labels and indents notes", () => {
    const text = renderReview([
      { label: "Team", value: "acme" },
      { label: "Git access", value: "git:write", note: "default" },
    ]);
    expect(text).toContain("  Team        acme\n");
    expect(text).toContain("└ default");
  });
});

describe("bounds calculation", () => {
  const config = parseConfig({
    source: { repo: "vercel/api" },
    credentials: {
      github: [
        {
          repo: "vercel/api",
          actions: ["issues:read", "pull-request:create", "git:write"],
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

  test("treats a repository with no bound as entirely missing", () => {
    expect(
      calculateMissingBounds(config, { status: "known", bounds: [] }),
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
