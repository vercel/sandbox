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
  const report = vi.fn();
  const parser = cmd.command({
    name: "scope",
    args: { scope: createScope(createTokenOption(false), report) },
    handler: (args) => args,
  });
  const result = await cmd.run(parser, args);
  return { result: result.scope, provenance: report.mock.calls[0]?.[0] };
}

test.each(["scope", "team"])(
  "attributes explicit --%s and --project separately",
  async (flag) => {
    const { result, provenance } = await parse([
      "--token=t",
      `--${flag}=team_explicit`,
      "--project=prj_explicit",
    ]);
    expect(result).toMatchObject({
      team: "team_explicit",
      project: "prj_explicit",
    });
    expect(provenance).toEqual({
      team: `from --${flag}`,
      project: "from --project",
    });
    expect(Auth.inferScope).not.toHaveBeenCalled();
  },
);

test("attributes the winning scope alias when both are provided", async () => {
  const { result, provenance } = await parse([
    "--token=t",
    "--team=other",
    "--scope=chosen",
    "--project=prj",
  ]);
  expect(result.team).toBe("chosen");
  expect(provenance.team).toBe("from --scope");
});

test("attributes linked scope to the project file", async () => {
  vi.mocked(readProjectConfiguration).mockReturnValue({
    orgId: "team_linked",
    projectId: "prj_linked",
  });
  const { provenance } = await parse(["--token=t"]);
  expect(provenance).toEqual({
    team: "from .vercel/project.json",
    project: "from .vercel/project.json",
  });
});

test("attributes default scope to account discovery without mislabeling an explicit project", async () => {
  vi.mocked(Auth.inferScope).mockResolvedValue({
    teamId: "team_default",
    projectId: "vercel-sandbox-default-project",
    created: false,
  });
  const { provenance } = await parse(["--token=t", "--project=prj_explicit"]);
  expect(provenance).toEqual({
    team: "inferred from Vercel account",
    project: "from --project",
  });
});

test("attributes an inferred project to the Sandbox default", async () => {
  vi.mocked(Auth.inferScope).mockResolvedValue({
    teamId: "team_default",
    projectId: "vercel-sandbox-default-project",
    created: false,
  });
  expect((await parse(["--token=t"])).provenance).toEqual({
    team: "inferred from Vercel account",
    project: "default Sandbox project",
  });
});

test("attributes token claims only to fields the token supplied", async () => {
  const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ owner_id: "team_token", project_id: "prj_token" })).toString("base64url")}.signature`;
  const { provenance } = await parse([
    `--token=${token}`,
    "--scope=team_explicit",
  ]);
  expect(provenance).toEqual({
    team: "from --scope",
    project: "from OIDC token claims",
  });
});

// Kept from the removed dry-run suite: explicit fields must not carry another
// project's display label, regardless of the authentication mode.
test.each([
  ["--scope=explicit-team", "teamSlug"],
  ["--project=explicit-project", "projectSlug"],
])("does not label %s with another target's OIDC slug", async (flag, slug) => {
  const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ owner_id: "team_token", project_id: "prj_token", owner: "token-team", project: "token-project" })).toString("base64url")}.signature`;
  const { result } = await parse([`--token=${token}`, flag]);
  expect(result[slug as "teamSlug" | "projectSlug"]).toBeUndefined();
});
