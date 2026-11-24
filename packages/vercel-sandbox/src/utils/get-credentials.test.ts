import { test, expect, beforeEach, vi } from "vitest";
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
});

test("explains how to set up oidc in local", async () => {
  delete process.env.VERCEL_URL;
  await expect(getCredentials()).rejects.toThrowError(LocalOidcContextError);
});

test("explains how to set up oidc in vercel", async () => {
  process.env.VERCEL_URL = "example.vercel.sh";
  await expect(getCredentials()).rejects.toThrowError(VercelOidcContextError);
});

test("accepts a header provider in place of a token", async () => {
  await expect(
    getCredentials({
      getAuthHeaders: () => ({}),
      teamId: "team_1",
      projectId: "prj_1",
    }),
  ).resolves.toEqual({ token: "", teamId: "team_1", projectId: "prj_1" });
});

test("keeps a given token when there is a header provider", async () => {
  await expect(
    getCredentials({
      getAuthHeaders: () => ({}),
      token: "token_1",
      teamId: "team_1",
      projectId: "prj_1",
    }),
  ).resolves.toEqual({
    token: "token_1",
    teamId: "team_1",
    projectId: "prj_1",
  });
});

test("still requires the team and the project with a header provider", async () => {
  await expect(
    getCredentials({ getAuthHeaders: () => ({}), teamId: "team_1" }),
  ).rejects.toThrowError(
    "Missing credentials parameters to access the Vercel API: projectId",
  );
});

test("still requires a token without a header provider", async () => {
  await expect(
    getCredentials({ teamId: "team_1", projectId: "prj_1" }),
  ).rejects.toThrowError(
    "Missing credentials parameters to access the Vercel API: token",
  );
});
