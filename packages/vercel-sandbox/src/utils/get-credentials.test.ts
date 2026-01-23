import { test, expect, beforeEach } from "vitest";
import {
  getCredentials,
  LocalOidcContextError,
  VercelOidcContextError,
} from "./get-credentials";

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
