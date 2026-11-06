import {
  configuration,
  credentialGroup,
} from "../fixtures/managed-credentials";
import { scriptedInput as io } from "../fixtures/managed-credentials";
import { describe, expect, test, vi } from "vitest";
import { parseConfig } from "../../src/util/managed-credentials-config";
import {
  buildReview,
  promptReviewDecision,
  renderReview,
} from "../../src/util/managed-credentials-review";

const review = (overrides: Record<string, unknown> = {}) =>
  buildReview({
    config: parseConfig(
      configuration(
        [
          credentialGroup(
            ["vercel/api"],
            ["github:issues:read", "git:write"],
            "@scubbo",
          ),
        ],
        { type: "git", url: "https://github.com/vercel/api.git" },
      ),
    ),
    team: "jacks-projects",
    project: "api",
    vcpus: 6,
    ...overrides,
  });

const valueOf = (rows: ReturnType<typeof buildReview>, label: string) =>
  rows.find((row) => row.label === label)?.value;

describe("review contents", () => {
  test("shows team, project, source, access, and resources", () => {
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
    expect(valueOf(review({ vcpus: 2 }), "Resources")).toBe("2 vCPUs");
  });

  test("derives commit credit from the selected GitHub actor", () => {
    const rows = review();
    expect(valueOf(rows, "Commit credit")).toBe("from @scubbo");
    expect(valueOf(rows, "GitHub actor")).toBe("@scubbo");
  });

  test("shows a Git-only list without adding API defaults", () => {
    const rows = buildReview({
      config: parseConfig(
        configuration([credentialGroup(["vercel/api"], ["git:write"])], {
          type: "git",
          url: "https://github.com/vercel/api.git",
        }),
      ),
      team: "t",
      project: "p",
      vcpus: 6,
    });
    expect(valueOf(rows, "Access vercel/api")).toBe("git:write");
  });

  test("lists each repository's access separately", () => {
    const rows = buildReview({
      config: parseConfig(
        configuration([
          credentialGroup(["acme/one"], ["github:issues:read"]),
          credentialGroup(["acme/two"], ["github:pull-request:create"]),
        ]),
      ),
      team: "t",
      project: "p",
      vcpus: 6,
    });
    expect(valueOf(rows, "Access acme/one")).toBe("github:issues:read");
    expect(valueOf(rows, "Access acme/two")).toBe("github:pull-request:create");
  });

  test("strips control characters from displayed values", () => {
    const rows = buildReview({
      config: parseConfig(
        configuration([credentialGroup(["vercel/api"], ["git:write"])], {
          type: "git",
          url: "https://github.com/vercel/api.git",
          revision: "main‮Evil",
        }),
      ),
      team: "t\u0000eam",
      project: "p",
      vcpus: 6,
    });
    expect(valueOf(rows, "Team")).toBe("team");
    expect(valueOf(rows, "Revision")).toBe("mainEvil");
  });
});

const input = () => ({
  config: parseConfig(
    configuration(
      [
        credentialGroup(
          ["acme/widgets"],
          ["git:write", "github:issues:read"],
          "2373726",
        ),
      ],
      {
        type: "git",
        url: "https://github.com/acme/widgets.git",
        revision: "main",
      },
    ),
  ),
  actor: { actAs: "2373726", login: "scubbo", source: "gh" as const },
  team: "vercel",
  project: "widgets",
  vcpus: 6,
});

describe("review identities", () => {
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

  test("shows backend-default actor and credit when no actor is selected", () => {
    const proposal = input();
    delete proposal.config.credentials.github[0].actAs;
    const rows = buildReview(proposal);
    expect(valueOf(rows, "GitHub actor")).toBe(
      "caller's connected GitHub account",
    );
    expect(valueOf(rows, "Commit credit")).toBe(
      "from caller's connected GitHub account",
    );
  });

  test("keeps multiple configured actors associated with their own repository", () => {
    const proposal = input();
    const config = parseConfig(
      configuration([
        credentialGroup(["acme/one"], ["github:issues:read"], "@one"),
        credentialGroup(["acme/two"], ["github:issues:comment"], "@two"),
      ]),
    );
    const rows = buildReview({
      ...proposal,
      config,
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
    expect(valueOf(rows, "Access acme/one")).toBe("github:issues:read");
    expect(valueOf(rows, "Access acme/two")).toBe("github:issues:comment");
  });
});

describe("two-column review rendering", () => {
  test("shows complete values without a From column", () => {
    const text = renderReview([
      { label: "Team", value: "vercel" },
      { label: "GitHub actor", value: "@scubbo" },
    ]);
    expect(text).toMatch(/Setting\s+Value/);
    expect(text).toMatch(/Team\s+vercel/);
    expect(text).toMatch(/GitHub actor\s+@scubbo/);
    expect(text).not.toMatch(/\bFrom\b/);
  });

  test("wraps long values within their column without losing permissions", () => {
    const actions =
      "github:pull-request:create, github:issues:read, github:issues:comment";
    const text = renderReview(
      [
        {
          label: "Access acme/widgets",
          value: actions,
        },
      ],
      80,
    );
    expect(text.split("\n").every((line) => line.length <= 80)).toBe(true);
    for (const action of actions.split(", ")) expect(text).toContain(action);
    expect(text).not.toContain("…");
  });

  test("strips control characters from both columns", () => {
    const text = renderReview([
      { label: "Team\u001b", value: "vercel\n\u202e" },
    ]);
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u202e");
  });
});

describe("creation consent prompt", () => {
  test("asks exactly the y/n question, with no edit menu", async () => {
    const streams = io(["n"]);
    await expect(promptReviewDecision(streams)).resolves.toEqual({
      action: "cancel",
    });
    expect(streams.text()).toBe("Create this sandbox? (y/n) ");
  });

  test.each(["y", "Y", "yes", " YES "])(
    "accepts only an affirmative answer: %j",
    async (answer) => {
      await expect(promptReviewDecision(io([answer]))).resolves.toEqual({
        action: "create",
      });
    },
  );

  test.each(["n", "no", "", "e", "edit", "c", "create", "other"])(
    "cancels on any other answer, without offering editing: %j",
    async (answer) => {
      // The second answer lets a reinstated edit menu finish rather than hang.
      const streams = io([answer, "n"]);
      await expect(promptReviewDecision(streams)).resolves.toEqual({
        action: "cancel",
      });
      expect(streams.text()).not.toContain("Which value");
    },
  );
});
