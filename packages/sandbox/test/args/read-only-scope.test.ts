import * as cmd from "cmd-ts";
import { afterEach, expect, test, vi } from "vitest";
import { createScope } from "../../src/args/scope";
import { createTokenOption } from "../../src/args/auth";
import { withFreshAuthRetry } from "../../src/util/fresh-auth-retry";
import * as Auth from "@vercel/sandbox/dist/auth/index.js";
vi.mock("../../src/util/fresh-auth-retry", () => ({
  withFreshAuthRetry: vi.fn(),
}));
vi.mock("../../src/util/project-configuration", () => ({
  readProjectConfiguration: () => undefined,
}));
vi.mock("@vercel/sandbox/dist/auth/index.js", async (original) => ({
  ...(await original<typeof Auth>()),
  inferScope: vi.fn(),
}));
afterEach(() => vi.unstubAllEnvs());
const parser = cmd.command({
  name: "readonly",
  args: { scope: createScope(createTokenOption(false, true), true) },
  handler: (args) => args,
});
test("dry-run uses explicit scope without refresh", async () => {
  expect(
    (await cmd.run(parser, ["--token=t", "--scope=team", "--project=project"]))
      .scope,
  ).toMatchObject({ token: "t", team: "team", project: "project" });
  expect(withFreshAuthRetry).not.toHaveBeenCalled();
});
test("dry-run refuses remote default-project creation", async () => {
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  expect((await cmd.runSafely(parser, ["--token=t"]))._tag).toBe("error");
  expect(Auth.inferScope).not.toHaveBeenCalled();
  expect(withFreshAuthRetry).not.toHaveBeenCalled();
});
test.each([
  ["--scope=explicit-team", "teamSlug"],
  ["--project=explicit-project", "projectSlug"],
])("does not label %s with another target's OIDC slug", async (flag, slug) => {
  const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ owner_id: "team_token", project_id: "prj_token", owner: "token-team", project: "token-project" })).toString("base64url")}.signature`;
  const result = await cmd.run(parser, [`--token=${token}`, flag]);
  expect(result.scope[slug as "teamSlug" | "projectSlug"]).toBeUndefined();
});
