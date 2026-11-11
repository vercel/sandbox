import type { SDKConfig } from "../../shared/src/config.js";
import { VERSION } from "./version.js";

export const sdkConfig: SDKConfig = {
  name: "vercel/drives",
  version: VERSION,
  docsLabel: "Vercel",
  docsUrl: "https://vercel.com/docs",
  telemetryDisabledEnv: [
    "VERCEL_SANDBOX_TELEMETRY_DISABLED",
    "VERCEL_DRIVES_TELEMETRY_DISABLED",
  ],
};
