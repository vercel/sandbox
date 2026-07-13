import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Load VERCEL_OIDC_TOKEN (and friends) from .env.local if present, so the
// [real] compat tests can run against a live sandbox. Without a token they
// are skipped automatically.
const envPath = path.resolve(import.meta.dirname, ".env.local");
if (existsSync(envPath)) loadEnvFile(envPath);

export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});
