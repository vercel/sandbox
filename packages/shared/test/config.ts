import type { SDKConfig } from "../src/config.js";

export const testConfig: SDKConfig = {
  name: "vercel/drives",
  version: "0.0.0",
  docsLabel: "Vercel",
  docsUrl: "https://vercel.com/docs",
  telemetryDisabledEnv: [
    "VERCEL_SANDBOX_TELEMETRY_DISABLED",
    "VERCEL_DRIVES_TELEMETRY_DISABLED",
  ],
};
