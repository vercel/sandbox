import * as cmd from "cmd-ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createScope } from "../../src/args/scope";
import { createTokenOption } from "../../src/args/auth";
import { readProjectConfiguration } from "../../src/util/project-configuration";
import * as Auth from "@vercel/sandbox/dist/auth/index.js";

vi.mock("../../src/util/project-configuration", () => ({
  readProjectConfiguration: vi.fn(),
}));
vi.mock("@vercel/sandbox/dist/auth/index.js", async (original) => ({
  ...(await original<typeof Auth>()),
  inferScope: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readProjectConfiguration).mockReturnValue(null);
});
afterEach(() => vi.unstubAllEnvs());

async function parse(args: string[]) {
  const parser = cmd.command({
    name: "scope",
    args: { scope: createScope(createTokenOption(false)) },
    handler: (args) => args,
  });
  const result = await cmd.run(parser, args);
  return result.scope;
}

test.each(["scope", "team"])(
  "keeps explicit --%s and --project selectors",
  async (flag) => {
    const result = await parse([
      "--token=t",
      `--${flag}=team_explicit`,
      "--project=prj_explicit",
    ]);
    expect(result).toMatchObject({
      team: "team_explicit",
      project: "prj_explicit",
    });
    expect(Auth.inferScope).not.toHaveBeenCalled();
  },
);

test("keeps the winning scope alias when both are provided", async () => {
  const result = await parse([
    "--token=t",
    "--team=other",
    "--scope=chosen",
    "--project=prj",
  ]);
  expect(result.team).toBe("chosen");
});

test("selects scope from the linked project file", async () => {
  vi.mocked(readProjectConfiguration).mockReturnValue({
    orgId: "team_linked",
    projectId: "prj_linked",
  });
  const result = await parse(["--token=t"]);
  expect(result).toMatchObject({ team: "team_linked", project: "prj_linked" });
  expect(Auth.inferScope).not.toHaveBeenCalled();
});

test("keeps the explicit project when discovering the default team", async () => {
  vi.mocked(Auth.inferScope).mockResolvedValue({
    teamId: "team_default",
    projectId: "vercel-sandbox-default-project",
    created: false,
  });
  const result = await parse(["--token=t", "--project=prj_explicit"]);
  expect(result).toMatchObject({
    team: "team_default",
    project: "prj_explicit",
  });
});

test("selects the Sandbox default project", async () => {
  vi.mocked(Auth.inferScope).mockResolvedValue({
    teamId: "team_default",
    projectId: "vercel-sandbox-default-project",
    created: false,
  });
  expect(await parse(["--token=t"])).toMatchObject({
    team: "team_default",
    project: "vercel-sandbox-default-project",
  });
});

test("fills only missing selectors from token claims", async () => {
  const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ owner_id: "team_token", project_id: "prj_token" })).toString("base64url")}.signature`;
  const result = await parse([`--token=${token}`, "--scope=team_explicit"]);
  expect(result).toMatchObject({ team: "team_explicit", project: "prj_token" });
});

// Kept from the removed dry-run suite: explicit fields must not carry another
// project's display label, regardless of the authentication mode.
test.each([
  ["--scope=explicit-team", "teamSlug"],
  ["--project=explicit-project", "projectSlug"],
])("does not label %s with another target's OIDC slug", async (flag, slug) => {
  const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ owner_id: "team_token", project_id: "prj_token", owner: "token-team", project: "token-project" })).toString("base64url")}.signature`;
  const result = await parse([`--token=${token}`, flag]);
  expect(result[slug as "teamSlug" | "projectSlug"]).toBeUndefined();
});
