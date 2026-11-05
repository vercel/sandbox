import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getConfigFilePath,
  getGlobalPathConfig,
} from "@vercel/cli-config/paths";
import { z } from "zod/v4";
import { CliError } from "./cli-error";

const configSchema = z.object({
  currentTeam: z
    .string()
    .min(1)
    .max(256)
    .refine(
      (value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
    )
    .nullish(),
});

/** Read the team selected by `vercel switch` without reading or changing auth. */
export function readVercelCurrentTeam(): string | undefined {
  try {
    const path = process.env.VERCEL_AUTH_CONFIG_DIR
      ? join(process.env.VERCEL_AUTH_CONFIG_DIR, "config.json")
      : getConfigFilePath(getGlobalPathConfig());
    return (
      configSchema.parse(JSON.parse(readFileSync(path, "utf8"))).currentTeam ??
      undefined
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
      return undefined;
    throw new CliError(
      "Could not read the team selected in Vercel CLI configuration. Repair config.json or pass --scope explicitly.",
      { reason: "invalid_context" },
    );
  }
}
