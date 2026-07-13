import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";

// Load credentials from .env.test if present (same convention as the
// vercel-sandbox package), for the [real] compat tests that run against a
// live sandbox when RUN_INTEGRATION_TESTS=1.
const envPath = path.resolve(import.meta.dirname, ".env.test");
if (existsSync(envPath)) loadEnvFile(envPath);
