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
  source: { type: "git", url: "https://github.com/acme/widgets.git" },
  commitAs: { name: "Grace Hopper", email: "grace@example.com" },
  credentials: {
    github: [
      {
        repositories: ["acme/widgets"],
        actions: ["git:write", "github:issues:read"],
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
  creationRequested: true,
  mode: { interactive: true, json: false },
  yes: false,
  managed: { config, origin: "flags", originLabel: "flags", provenance: {} },
  managedOptions: { credentialsActions: [], enableManagedCredentials: true },
});

beforeEach(() => {
  vi.clearAllMocks();
  lookup.mockResolvedValue(true);
});

test("reads Bounds for the selected IDs, never the review labels", async () => {
  flow.mockImplementation(async (options: { context: FlowContext }) => {
    // Display labels and policy selectors are separate: the slugs reach the
    // review table, and only the selected IDs reach the policy read.
    expect(options.context.displayScope).toEqual({
      team: "example",
      project: "widgets",
    });
    await options.context.hasProjectBounds!({
      team: options.context.team,
      project: options.context.project,
    });
  });
  await prepareManagedCredentials({ context: context() });
  expect(lookup).toHaveBeenCalledExactlyOnceWith({
    token: "existing-token",
    team: "team_Original",
    project: "prj_Original",
    api: { run: expect.any(Function) },
  });
});

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
