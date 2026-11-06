import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CreateContext } from "../../src/args/create-context";
import { CliError } from "../../src/util/cli-error";
import { parseConfig } from "../../src/util/managed-credentials-config";
import { prepareManagedCredentials } from "../../src/util/managed-credentials-create";
import { buildReview } from "../../src/util/managed-credentials-review";

const { bounds, prompt } = vi.hoisted(() => ({
  bounds: vi.fn(),
  prompt: vi.fn(),
}));
vi.mock("../../src/util/managed-credentials-project-bounds", () => ({
  hasProjectBounds: bounds,
}));
vi.mock("../../src/util/managed-credentials-review", async (original) => ({
  ...(await original<
    typeof import("../../src/util/managed-credentials-review")
  >()),
  promptReviewDecision: prompt,
}));

const TEAM = "team_Linked123";
const PROJECT = "prj_Linked123";
const config = parseConfig({
  source: { type: "git", url: "https://github.com/acme/widgets.git" },
  credentials: {
    github: [
      {
        repositories: ["acme/widgets"],
        actions: ["git:write"],
        actAs: "@grace",
      },
    ],
  },
});
function context(): CreateContext {
  return {
    token: "existing-token",
    team: TEAM,
    project: PROJECT,
    creationRequested: true,
    interactive: true,
    yes: false,
    scopeProvenance: {
      team: "from .vercel/project.json",
      project: "from .vercel/project.json",
    },
    managed: {
      config,
      origin: "flags",
      originLabel: "command-line flags",
      provenance: {},
    },
  };
}
let output: string;
let requests: string[];
beforeEach(() => {
  vi.clearAllMocks();
  output = "";
  requests = [];
  bounds.mockResolvedValue(true);
  prompt.mockResolvedValue({ action: "create" });
  vi.spyOn(process.stderr, "write").mockImplementation((text) => {
    output += String(text);
    return true;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer existing-token",
      );
      const url = new URL(String(input));
      requests.push(url.href);
      if (url.pathname === `/api/v2/teams/${TEAM}`)
        return Response.json({ id: TEAM, slug: "linked-team" });
      if (url.pathname === `/api/v9/projects/${PROJECT}`) {
        expect(url.searchParams.get("teamId")).toBe(TEAM);
        return Response.json({
          id: PROJECT,
          accountId: TEAM,
          name: "linked-project",
        });
      }
      throw new Error("Unexpected metadata request");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("linked IDs display looked-up names without changing API selectors, provenance or token", async () => {
  const ctx = context();
  const original = structuredClone(ctx);
  const prepared = await prepareManagedCredentials({ context: ctx });
  expect(output).toMatch(/Team\s+linked-team\s+from \.vercel\/project.json/);
  expect(output).toMatch(
    /Project\s+linked-project\s+from \.vercel\/project.json/,
  );
  expect(output).not.toContain(TEAM);
  expect(output).not.toContain(PROJECT);
  expect(bounds).toHaveBeenCalledExactlyOnceWith({
    token: "existing-token",
    team: TEAM,
    project: PROJECT,
    api: { run: expect.any(Function) },
  });
  expect(prepared?.config).toEqual(config);
  expect(ctx).toEqual(original);
  expect(requests).toHaveLength(2);
});

test("unreadable names retain IDs with a note and do not bypass an unreadable Bounds policy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 403 })),
  );
  bounds.mockRejectedValue(
    new CliError("Project Bounds could not be read.", {
      reason: "policy_unknown",
    }),
  );
  await expect(
    prepareManagedCredentials({ context: context() }),
  ).rejects.toMatchObject({ options: { reason: "policy_unknown" } });
  expect(output).toContain(TEAM);
  expect(output).toContain(PROJECT);
  expect(output).toMatch(/name lookup\s+unavailable/);
  expect(output).toContain("from .vercel/project.json");
  expect(bounds).toHaveBeenCalledExactlyOnceWith({
    token: "existing-token",
    team: TEAM,
    project: PROJECT,
    api: { run: expect.any(Function) },
  });
});

test.each([PROJECT, "Qm" + "a".repeat(44)])(
  "the pure review retains unresolved IDs and annotates the missing names (%s)",
  (project) => {
    const rows = buildReview({
      config,
      originLabel: "flags",
      provenance: {},
      team: TEAM,
      project,
      vcpus: 6,
      vcpusExplicit: false,
    });
    expect(rows.find((row) => row.label === "Team")).toMatchObject({
      value: TEAM,
      note: "provided scope (name lookup unavailable)",
    });
    expect(rows.find((row) => row.label === "Project")).toMatchObject({
      value: project,
      note: "provided scope (name lookup unavailable)",
    });
  },
);
