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
    ...overrides,
  });

const valueOf = (rows: ReturnType<typeof buildReview>, label: string) =>
  rows.find((row) => row.label === label)?.value;

describe("review contents", () => {
  test("shows only the requested parameter rows with Git and API actions together", () => {
    const rows = review();
    expect(rows).toEqual([
      { label: "Team", value: "jacks-projects" },
      { label: "Project", value: "api" },
      { label: "Source", value: "vercel/api" },
      { label: "Actions", value: "github:issues:read, git:write" },
      { label: "GitHub actor", value: "@scubbo" },
    ]);
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
    });
    expect(valueOf(rows, "Actions")).toBe("git:write");
  });

  test("lists each repository's actions separately", () => {
    const rows = buildReview({
      config: parseConfig(
        configuration([
          credentialGroup(["acme/one"], ["github:issues:read"]),
          credentialGroup(["acme/two"], ["github:pull-request:create"]),
        ]),
      ),
      team: "t",
      project: "p",
    });
    expect(
      rows.filter((row) => row.label === "Actions").map((row) => row.value),
    ).toEqual([
      "acme/one: github:issues:read",
      "acme/two: github:pull-request:create",
    ]);
  });

  test("keeps a long repository's Git write in the same Actions row", () => {
    const config = parseConfig(
      configuration(
        [
          credentialGroup(
            ["vercel-labs/agent-factory"],
            [
              "github:issues:read",
              "github:issues:comment",
              "github:pull-request:create",
              "git:write",
            ],
            "@scubbo",
          ),
        ],
        {
          type: "git",
          url: "https://github.com/vercel-labs/agent-factory.git",
        },
      ),
    );
    const before = JSON.stringify(config);
    const rows = review({ config });
    expect(rows.filter((row) => row.label === "Actions")).toEqual([
      {
        label: "Actions",
        value:
          "github:issues:read, github:issues:comment, github:pull-request:create, git:write",
      },
    ]);
    const text = renderReview(rows, 80);
    expect(text).toMatch(/Source\s+vercel-labs\/agent-factory/);
    expect(text).toMatch(/Actions\s+github:issues:read/);
    expect(text).toContain("git:write");
    expect(text).not.toContain("Access");
    expect(JSON.stringify(config)).toBe(before);
  });

  test.each([
    undefined,
    { type: "git", url: "https://github.com/acme/clone.git" },
  ])(
    "names the action target when it is not the clone source: %j",
    (source) => {
      const rows = review({
        config: parseConfig(
          configuration(
            [
              credentialGroup(
                ["acme/target"],
                ["github:issues:read"],
                "@scubbo",
              ),
            ],
            source,
          ),
        ),
      });
      expect(valueOf(rows, "Actions")).toBe("acme/target: github:issues:read");
    },
  );

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
  actor: { actAs: "2373726", login: "scubbo" },
  team: "vercel",
  project: "widgets",
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

  test("shows the backend-default actor when no actor is selected", () => {
    const proposal = input();
    delete proposal.config.credentials.github[0].actAs;
    const rows = buildReview(proposal);
    expect(valueOf(rows, "GitHub actor")).toBe(
      "caller's connected GitHub account",
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
      rows
        .filter((row) => row.label === "GitHub actor")
        .map((row) => row.value),
    ).toEqual(["acme/one: @one", "acme/two: @two"]);
    expect(
      rows.filter((row) => row.label === "Actions").map((row) => row.value),
    ).toEqual([
      "acme/one: github:issues:read",
      "acme/two: github:issues:comment",
    ]);
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
          label: "Actions",
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
