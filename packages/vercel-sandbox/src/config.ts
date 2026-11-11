import type { SDKConfig } from "../../shared/src/config.js";
import { VERSION } from "./version.js";

export const sdkConfig: SDKConfig = {
  name: "vercel/sandbox",
  version: VERSION,
  docsLabel: "Sandbox",
  docsUrl: "https://vercel.com/docs/vercel-sandbox",
  telemetryDisabledEnv: ["VERCEL_SANDBOX_TELEMETRY_DISABLED"],
};
