import { beforeEach, expect, test, vi } from "vitest";
import type { CreateContext } from "../../src/args/create-context";
import type { FlowContext } from "../../src/util/managed-credentials-flow";
import { parseConfig } from "../../src/util/managed-credentials-config";
import { CliError } from "../../src/util/cli-error";
import { prepareManagedCredentials } from "../../src/util/managed-credentials-create";

const { lookup, flow } = vi.hoisted(() => ({ lookup: vi.fn(), flow: vi.fn() }));
vi.mock("../../src/util/managed-credentials-project-bounds", () => ({
  hasProjectBounds: lookup,
}));
vi.mock("../../src/util/managed-credentials-flow", () => ({
  runManagedCredentialsFlow: flow,
}));

const config = parseConfig({
  source: { repo: "acme/widgets" },
  commitAs: { name: "Grace Hopper", email: "grace@example.com" },
  credentials: {
    github: [
      {
        repo: "acme/widgets",
        actions: ["git:write", "issues:read"],
        actAs: "42",
      },
    ],
  },
});
const context = (): CreateContext => ({
  token: "existing-token",
  team: "team_Original",
  teamSlug: "example",
  project: "prj_Original",
  projectSlug: "widgets",
  creation: {},
  creationRequested: true,
  mode: { interactive: true, json: false },
  yes: false,
  dryRun: false,
  managed: { config, origin: "flags", originLabel: "flags", provenance: {} },
  managedOptions: { credentialsActions: [], enableManagedCredentials: true },
});

beforeEach(() => {
  vi.clearAllMocks();
  lookup.mockResolvedValue(true);
});

test.each([
  ["example", "widgets", "team_Original", "prj_Original"],
  ["team_Original", "prj_Original", "team_Original", "prj_Original"],
  ["example", "corrected-project", "team_Original", "corrected-project"],
  ["corrected-team", "widgets", "corrected-team", "widgets"],
  ["team_Corrected", "prj_Corrected", "team_Corrected", "prj_Corrected"],
])(
  "reads Bounds for the approved scope %s/%s",
  async (team, project, expectedTeam, expectedProject) => {
    flow.mockImplementation(async (options: { context: FlowContext }) => {
      await options.context.hasProjectBounds!({ team, project });
      return {
        config,
        team,
        project,
        missingBounds: [],
        boundsApproved: false,
      };
    });
    await prepareManagedCredentials({ context: context() });
    expect(lookup).toHaveBeenCalledExactlyOnceWith({
      token: "existing-token",
      team: expectedTeam,
      project: expectedProject,
    });
  },
);

test.each([false, true])(
  "policy errors retain the requested JSON mode: %s",
  async (json) => {
    lookup.mockRejectedValue(
      new CliError("Project Bounds could not be read.", {
        reason: "policy_unknown",
        exitCode: 1,
      }),
    );
    flow.mockImplementation(async (options: { context: FlowContext }) => {
      await options.context.hasProjectBounds!({
        team: "example",
        project: "widgets",
      });
    });
    const ctx = context();
    ctx.mode = { interactive: false, json };
    ctx.yes = true;
    await expect(
      prepareManagedCredentials({ context: ctx }),
    ).rejects.toMatchObject({
      options: { reason: "policy_unknown", exitCode: 1, json },
    });
  },
);

test("an unreadable policy stops preparation instead of becoming no Bounds", async () => {
  lookup.mockRejectedValue(new Error("policy unavailable"));
  flow.mockImplementation(async (options: { context: FlowContext }) => {
    await options.context.hasProjectBounds!({
      team: "example",
      project: "widgets",
    });
  });
  await expect(
    prepareManagedCredentials({ context: context() }),
  ).rejects.toThrow("policy unavailable");
});
