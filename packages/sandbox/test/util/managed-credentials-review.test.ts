import { describe, expect, test, vi } from "vitest";
import { parseConfig } from "../../src/util/managed-credentials-config";
import {
  buildReview,
  renderReview,
} from "../../src/util/managed-credentials-review";

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
      commitAs: "actor-derived",
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

const input = () => ({
  config: parseConfig({
    source: {
      type: "git",
      url: "https://github.com/acme/widgets.git",
      revision: "main",
    },
    commitAs: { name: "Grace Hopper", email: "grace@example.com" },
    credentials: {
      github: [
        {
          repositories: ["acme/widgets"],
          actions: ["git:write", "github:issues:read"],
          actAs: "2373726",
        },
      ],
    },
  }),
  originLabel: "command-line flags",
  provenance: {
    repository: "git-remote" as const,
    commitAs: "actor-derived" as const,
    actor: "gh" as const,
    actions: "default" as const,
    team: "inferred from the signed-in Vercel account",
    project: "default Sandbox project",
  },
  actor: { actAs: "2373726", login: "scubbo", source: "gh" as const },
  team: "vercel",
  project: "widgets",
  vcpus: 6,
  vcpusExplicit: false,
  missingBounds: [],
});

describe("complete review provenance", () => {
  test("uses the resolved username without changing the authorization selector", () => {
    const proposal = input();
    const before = JSON.stringify(proposal.config);
    const rows = buildReview(proposal);
    const actors = rows.filter((row) => row.label.startsWith("GitHub actor"));
    expect(actors).toHaveLength(1);
    expect(actors[0].value).toBe("@scubbo");
    expect(JSON.stringify(rows)).not.toContain("2373726");
    expect(JSON.stringify(proposal.config)).toBe(before);
    expect(proposal.config.credentials.github[0].actAs).toBe("2373726");
  });

  test("does not attach another account's username to an unmatched ID", () => {
    const proposal = input();
    proposal.actor.actAs = "42";
    const actor = buildReview(proposal).find((row) =>
      row.label.startsWith("GitHub actor"),
    );
    expect(actor?.value).toBe("GitHub username unavailable");
    expect(actor?.value).not.toContain("scubbo");
    expect(actor?.value).not.toContain("2373726");
  });

  test.each([
    ["gh", "inferred from active gh account"],
    ["vercel-account-link", "from Vercel-linked GitHub account"],
    ["explicit", "from --credentials-github-act-as"],
    ["config", "from configuration file permissions.json"],
  ] as const)(
    "uses the same %s annotation for the GitHub actor and derived commit credit",
    (actor, annotation) => {
      const proposal = input();
      delete proposal.config.commitAs;
      const rows = buildReview({
        ...proposal,
        originLabel: "configuration file permissions.json",
        provenance: { ...proposal.provenance, actor },
      });
      expect(rows.find((row) => row.label === "GitHub actor")?.note).toBe(
        annotation,
      );
      expect(rows.find((row) => row.label === "Commit credit")?.note).toBe(
        annotation,
      );
      expect(rows.find((row) => row.label === "Commit credit")?.value).toBe(
        "from @scubbo",
      );
    },
  );

  test("preserves the backend-default annotation when no actor is selected", () => {
    const proposal = input();
    delete proposal.config.commitAs;
    delete proposal.config.credentials.github[0].actAs;
    const rows = buildReview(proposal);
    expect(rows.find((row) => row.label === "Commit credit")?.note).toBe(
      rows.find((row) => row.label === "GitHub actor")?.note,
    );
  });

  test("gives every displayed field a source and removes the configuration row", () => {
    const rows = buildReview(input());
    expect(rows.every((row) => !!row.note?.trim())).toBe(true);
    expect(rows.find((row) => row.label === "Team")?.note).toContain(
      "signed-in Vercel account",
    );
    expect(rows.find((row) => row.label === "Project")?.note).toBe(
      "default Sandbox project",
    );
    expect(rows.find((row) => row.label.startsWith("Access "))?.note).toContain(
      "default",
    );
    expect(
      rows.find((row) => row.label.startsWith("GitHub actor"))?.note,
    ).toContain("gh account");
    expect(rows.some((row) => row.label === "Configuration")).toBe(false);
  });

  test.each([
    ["explicit", "--credentials-github-action"],
    ["github-access", "--github-access"],
    ["config", "configuration file"],
  ])("describes %s API permissions", (actions, label) => {
    const proposal = input();
    const rows = buildReview({
      ...proposal,
      originLabel: "configuration file permissions.json",
      provenance: { ...proposal.provenance, actions },
    } as Parameters<typeof buildReview>[0]);
    expect(rows.find((row) => row.label.startsWith("Access "))?.note).toContain(
      label,
    );
  });

  test("attributes a corrected invocation to its explicit flags", () => {
    const proposal = input();
    const rows = buildReview({
      ...proposal,
      provenance: {
        ...proposal.provenance,
        repository: "explicit",
        actor: "explicit",
        actions: "explicit",
        commitAs: "explicit",
      },
    });
    for (const [label, flag] of [
      ["Source", "--credentials-github-repo"],
      ["Access acme/widgets", "--credentials-github-action"],
      ["GitHub actor", "--credentials-github-act-as"],
      ["Commit credit", "--credentials-github-commit-as"],
    ])
      expect(rows.find((row) => row.label === label)?.note).toBe(
        `from ${flag}${label === "Commit credit" ? "; legacy override" : ""}`,
      );
  });

  test("keeps multiple configured actors associated with their own repository", () => {
    const proposal = input();
    const config = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["acme/one"],
            actions: ["github:issues:read"],
            actAs: "@one",
          },
          {
            repositories: ["acme/two"],
            actions: ["github:issues:read"],
            actAs: "@two",
          },
        ],
      },
    });
    const rows = buildReview({
      ...proposal,
      config,
      originLabel: "configuration file permissions.json",
      provenance: { repository: "config", actor: "config", actions: "config" },
    } as Parameters<typeof buildReview>[0]);
    expect(
      rows.find((row) => row.label === "GitHub actor acme/one")?.value,
    ).toBe("@one");
    expect(
      rows.find((row) => row.label === "GitHub actor acme/two")?.value,
    ).toBe("@two");
    expect(
      rows.filter((row) => row.label.startsWith("GitHub actor")),
    ).toHaveLength(2);
  });
});

describe("three-column review rendering", () => {
  test("puts each source beside the value, not on an extra note line", () => {
    const text = renderReview([
      { label: "Team", value: "vercel", note: "from --scope" },
      { label: "GitHub actor", value: "@scubbo", note: "from gh" },
    ]);
    expect(text).toMatch(/Setting\s+Value\s+From/);
    expect(text).toMatch(/Team\s+vercel\s+from --scope/);
    expect(text).toMatch(/GitHub actor\s+@scubbo\s+from gh/);
    expect(text).not.toContain("└");
  });

  test("wraps long values within their column without losing permissions", () => {
    const actions =
      "github:pull-request:create, github:issues:read, github:issues:comment";
    const text = renderReview(
      [
        {
          label: "Access acme/widgets",
          value: actions,
          note: "from --credentials-github-action",
        },
      ],
      80,
    );
    expect(text.split("\n").every((line) => line.length <= 80)).toBe(true);
    for (const action of actions.split(", ")) expect(text).toContain(action);
    expect(text).not.toContain("…");
  });

  test("strips control characters from all three columns", () => {
    const text = renderReview([
      { label: "Team\u001b", value: "vercel\n", note: "from\u202e --scope" },
    ]);
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u202e");
  });
});
