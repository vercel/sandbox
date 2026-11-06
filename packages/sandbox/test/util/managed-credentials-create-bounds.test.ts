import {
  configuration,
  credentialGroup,
} from "../fixtures/managed-credentials";
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

const config = parseConfig(
  configuration(
    [
      credentialGroup(
        ["acme/widgets"],
        ["git:write", "github:issues:read"],
        "42",
      ),
    ],
    { type: "git", url: "https://github.com/acme/widgets.git" },
  ),
);
const context = (): CreateContext => ({
  token: "existing-token",
  team: "team_Original",
  teamSlug: "example",
  project: "prj_Original",
  projectSlug: "widgets",
  creationRequested: true,
  interactive: true,
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

test("policy errors keep their reason and exit code", async () => {
  const error = new CliError("Project Bounds could not be read.", {
    reason: "policy_unknown",
    exitCode: 1,
  });
  lookup.mockRejectedValue(error);
  flow.mockImplementation(async (options: { context: FlowContext }) => {
    await options.context.hasProjectBounds!({
      team: "example",
      project: "widgets",
    });
  });
  const ctx = context();
  ctx.interactive = false;
  ctx.yes = true;
  await expect(prepareManagedCredentials({ context: ctx })).rejects.toBe(error);
});

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
