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
