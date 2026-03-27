import pico from "picocolors";
import type { Credentials } from "./get-credentials";

/**
 * Credentials accepted by {@link setSandboxCredentials}.
 * `projectId` is optional because deserialized instances typically
 * don't need a project context.
 */
export type SandboxCredentials = Pick<Credentials, "token" | "teamId"> &
  Partial<Pick<Credentials, "projectId">>;

let sandboxCredentials: SandboxCredentials | null = null;

/**
 * Set global credentials for Sandbox and Command instances.
 * These credentials are used when lazily creating API clients for deserialized instances.
 *
 * Must be called in the module scope before using deserialized
 * Sandbox or Command instances.
 *
 * @param credentials - The credentials to use globally
 */
export function setSandboxCredentials(credentials: SandboxCredentials): void {
  sandboxCredentials = credentials;
}

/**
 * Get the global credentials.
 * Throws if {@link setSandboxCredentials} has not been called.
 * @internal
 */
export function getSandboxCredentials(): SandboxCredentials {
  if (!sandboxCredentials) {
    throw new Error(
      [
        `Global credentials have not been set.`,
        `${pico.bold("hint:")} Call setSandboxCredentials() in the module scope before using deserialized instances.`,
        "├▶ Docs: https://vercel.com/docs/vercel-sandbox",
        "╰▶ Example:",
        "     import { setSandboxCredentials } from '@vercel/sandbox';",
        "     setSandboxCredentials({ token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID });",
      ].join("\n"),
    );
  }
  return sandboxCredentials;
}
