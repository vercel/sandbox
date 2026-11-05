import * as cmd from "cmd-ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as Auth from "@vercel/sandbox/dist/auth/index.js";
import { createScope } from "../../src/args/scope";
import { createTokenOption } from "../../src/args/auth";
import { readProjectConfiguration } from "../../src/util/project-configuration";

vi.mock("../../src/util/project-configuration", () => ({
  readProjectConfiguration: vi.fn(),
}));
vi.mock("@vercel/sandbox/dist/auth/index.js", async (original) => ({
  ...(await original<typeof Auth>()),
  inferScope: vi.fn(),
}));

let directory: string;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), "sandbox-selected-team-"));
  vi.stubEnv("VERCEL_AUTH_CONFIG_DIR", directory);
  vi.mocked(readProjectConfiguration).mockReturnValue(null);
  vi.mocked(Auth.inferScope).mockImplementation(async (options) => ({
    teamId: options.teamId ?? "team_account_default",
    teamSlug:
      options.teamId === "team_selected" ? "selected-team" : "account-team",
    projectId: "vercel-sandbox-default-project",
    projectSlug: "vercel-sandbox-default-project",
    created: false,
  }));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function selectedTeam(value: unknown = "team_selected") {
  await writeFile(
    join(directory, "config.json"),
    JSON.stringify({ currentTeam: value }),
  );
}
async function parse(args: string[] = []) {
  const report = vi.fn();
  const parser = cmd.command({
    name: "selected-team",
    args: { scope: createScope(createTokenOption(false, true), true, report) },
    handler: (args) => args,
  });
  const result = await cmd.run(
    parser,
    args.some((arg) => arg.startsWith("--token="))
      ? args
      : ["--token=t", ...args],
  );
  return { scope: result.scope, provenance: report.mock.calls[0]?.[0] };
}

test("uses the team selected by vercel switch ahead of the account default", async () => {
  await selectedTeam();
  const { scope, provenance } = await parse();
  expect(scope).toMatchObject({
    team: "team_selected",
    teamSlug: "selected-team",
    project: "vercel-sandbox-default-project",
  });
  expect(Auth.inferScope).toHaveBeenCalledExactlyOnceWith({
    token: "t",
    teamId: "team_selected",
    readOnly: true,
  });
  expect(provenance).toEqual({
    team: "from vercel switch",
    project: "default Sandbox project",
  });
});

test("does not mislabel an explicit project when the team comes from vercel switch", async () => {
  await selectedTeam();
  const { scope, provenance } = await parse(["--project=agent-factory-h87v"]);
  expect(scope).toMatchObject({
    team: "team_selected",
    project: "agent-factory-h87v",
  });
  expect(provenance).toEqual({
    team: "from vercel switch",
    project: "from --project",
  });
});

test.each(["scope", "team"])(
  "explicit --%s wins even if CLI configuration is malformed",
  async (flag) => {
    await writeFile(
      join(directory, "config.json"),
      "private-config-canary: malformed",
    );
    expect((await parse([`--${flag}=team_explicit`])).scope.team).toBe(
      "team_explicit",
    );
    expect(Auth.inferScope).toHaveBeenCalledExactlyOnceWith({
      token: "t",
      teamId: "team_explicit",
      readOnly: true,
    });
  },
);

test("linked project context wins over vercel switch", async () => {
  await selectedTeam();
  vi.mocked(readProjectConfiguration).mockReturnValue({
    orgId: "team_linked",
    projectId: "prj_linked",
  });
  expect((await parse()).scope).toMatchObject({
    team: "team_linked",
    project: "prj_linked",
  });
  expect(Auth.inferScope).not.toHaveBeenCalled();
});

test("OIDC context wins over vercel switch", async () => {
  await selectedTeam();
  const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ owner_id: "team_oidc", project_id: "prj_oidc" })).toString("base64url")}.signature`;
  expect((await parse([`--token=${token}`])).scope).toMatchObject({
    team: "team_oidc",
    project: "prj_oidc",
  });
  expect(Auth.inferScope).not.toHaveBeenCalled();
});

test.each([undefined, null])(
  "keeps account fallback when no current team is saved (%s)",
  async (value) => {
    if (value === null) await selectedTeam(null);
    expect((await parse()).scope.team).toBe("team_account_default");
    expect(Auth.inferScope).toHaveBeenCalledWith({
      token: "t",
      teamId: undefined,
      readOnly: true,
    });
  },
);

test.each([403, 404])(
  "never silently falls back from the selected team after HTTP %s",
  async (statusCode) => {
    await selectedTeam();
    vi.mocked(Auth.inferScope).mockRejectedValue(
      new Auth.NotOk({
        statusCode,
        responseText: "Selected team lookup failed",
      }),
    );
    await expect(parse()).rejects.toThrow();
    expect(Auth.inferScope).toHaveBeenCalledExactlyOnceWith({
      token: "t",
      teamId: "team_selected",
      readOnly: true,
    });
  },
);

test("fails closed on unreadable configuration without exposing its contents", async () => {
  await writeFile(
    join(directory, "config.json"),
    "private-config-canary: malformed",
  );
  await expect(parse()).rejects.toThrow();
  expect(Auth.inferScope).not.toHaveBeenCalled();
});
