import { test, expect, beforeEach, vi } from "vitest";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  getCredentials,
  LocalOidcContextError,
  VercelOidcContextError,
} from "./get-credentials.js";

// Force `getVercelOidcToken` to reject so the error-path in `getCredentials`
// runs deterministically. Without this, `@vercel/oidc` discovers the developer's
// linked project via `.vercel/project.json` and refreshes a real token from
// stored `vc` auth — masking the missing-context error these tests assert on.
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(async () => {
    throw new Error("no OIDC context");
  }),
}));

beforeEach(() => {
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_TEAM_ID;
  delete process.env.VERCEL_ORG_ID;
  delete process.env.VERCEL_PROJECT_ID;
});

function setAccessTokenEnvironment() {
  process.env.VERCEL_TOKEN = "env-token";
  process.env.VERCEL_TEAM_ID = "team_env";
  process.env.VERCEL_PROJECT_ID = "prj_env";
}

test("uses VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID without an OIDC token", async () => {
  setAccessTokenEnvironment();
  await expect(getCredentials()).resolves.toEqual({
    token: "env-token",
    teamId: "team_env",
    projectId: "prj_env",
  });
});

test("prefers an OIDC token over the access token environment variables", async () => {
  setAccessTokenEnvironment();
  const payload = Buffer.from(
    JSON.stringify({ owner_id: "team_oidc", project_id: "prj_oidc" }),
  ).toString("base64url");
  const oidcToken = `header.${payload}.signature`;
  vi.mocked(getVercelOidcToken).mockResolvedValueOnce(oidcToken);

  await expect(getCredentials()).resolves.toEqual({
    token: oidcToken,
    teamId: "team_oidc",
    projectId: "prj_oidc",
  });
});

test("accepts VERCEL_ORG_ID in place of VERCEL_TEAM_ID", async () => {
  setAccessTokenEnvironment();
  delete process.env.VERCEL_TEAM_ID;
  process.env.VERCEL_ORG_ID = "team_org";
  await expect(getCredentials()).resolves.toMatchObject({ teamId: "team_org" });
});

test("fails when VERCEL_TEAM_ID and VERCEL_ORG_ID name different teams", async () => {
  setAccessTokenEnvironment();
  process.env.VERCEL_ORG_ID = "team_other";
  await expect(getCredentials()).rejects.toThrowError(
    /VERCEL_TEAM_ID \(team_env\) and VERCEL_ORG_ID \(team_other\)/,
  );
});

test("ignores VERCEL_TOKEN without a team and project", async () => {
  delete process.env.VERCEL_URL;
  process.env.VERCEL_TOKEN = "env-token";
  await expect(getCredentials()).rejects.toThrowError(LocalOidcContextError);
});

test("explains how to set up oidc in local", async () => {
  delete process.env.VERCEL_URL;
  await expect(getCredentials()).rejects.toThrowError(LocalOidcContextError);
});

test("explains how to set up oidc in vercel", async () => {
  process.env.VERCEL_URL = "example.vercel.sh";
  await expect(getCredentials()).rejects.toThrowError(VercelOidcContextError);
});
