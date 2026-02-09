import { getVercelOidcToken } from "@vercel/oidc";
import { decodeBase64Url } from "./decode-base64-url";
import { z } from "zod";
import {
  cachedGenerateCredentials,
  shouldPromptForCredentials,
} from "./dev-credentials";

export interface Credentials {
  /**
   * Authentication token for the Vercel API. It could be an OIDC token
   * or a personal access token.
   */
  token: string;
  /**
   * The ID of the project to associate Sandbox operations.
   */
  projectId: string;
  /**
   * The ID of the team to associate Sandbox operations.
   */
  teamId: string;
}

/**
 * Error thrown when OIDC context is not available in local development,
 * therefore we should guide how to ensure it is set up by linking a project
 */
export class LocalOidcContextError extends Error {
  name = "LocalOidcContextError";
  constructor(cause: unknown) {
    const message = [
      "Could not get credentials from OIDC context.",
      "Please link your Vercel project using `npx vercel link`.",
      "Then, pull an initial OIDC token with `npx vercel env pull`",
      "and retry.",
      "╰▶ Make sure you are loading `.env.local` correctly, or passing $VERCEL_OIDC_TOKEN directly.",
    ].join("\n");
    super(message, { cause });
  }
}

/**
 * Error thrown when OIDC context is not available in Vercel environment,
 * therefore we should guide how to set it up.
 */
export class VercelOidcContextError extends Error {
  name = "VercelOidcContextError";
  constructor(cause: unknown) {
    const message = [
      "Could not get credentials from OIDC context.",
      "Please make sure OIDC is set up for your project",
      "╰▶ Docs: https://vercel.com/docs/oidc",
    ].join("\n");
    super(message, { cause });
  }
}

async function getVercelToken(opts: {
  teamId?: string;
  projectId?: string;
}): Promise<Credentials> {
  try {
    // Pass team and project to getVercelOidcToken to enable token refresh
    // without needing to read from .vercel/project.json. `project` must be a
    // project ID (prj_*), `team` accepts both IDs (team_*) and slugs.
    const token = await getVercelOidcToken({
      team: opts.teamId,
      project: opts.projectId,
    });
    return getCredentialsFromOIDCToken(token);
  } catch (error) {
    if (!shouldPromptForCredentials()) {
      if (process.env.VERCEL_URL) {
        throw new VercelOidcContextError(error);
      } else {
        throw new LocalOidcContextError(error);
      }
    }
    return await cachedGenerateCredentials(opts);
  }
}

/**
 * Allow to get credentials to access the Vercel API. Credentials can be
 * provided in two different ways:
 *
 * 1. By passing an object with the `teamId`, `token`, and `projectId` properties.
 * 2. By using an environment variable VERCEL_OIDC_TOKEN.
 *
 * If both methods are used, the object properties take precedence over the
 * environment variable. If neither method is used, an error is thrown.
 */
export async function getCredentials(params?: unknown): Promise<Credentials> {
  const credentials = getCredentialsFromParams(params ?? {});
  if (credentials) {
    return credentials;
  }

  const oidcToken = await getVercelToken({
    teamId:
      params &&
      typeof params === "object" &&
      "teamId" in params &&
      typeof params.teamId === "string"
        ? params.teamId
        : undefined,
    projectId:
      params &&
      typeof params === "object" &&
      "projectId" in params &&
      typeof params.projectId === "string"
        ? params.projectId
        : undefined,
  });

  return oidcToken;
}

/**
 * Attempt to extract credentials from the provided parameters. Either all
 * required fields (`token`, `teamId`, and `projectId`) must be present
 * or none of them, otherwise an error is thrown.
 */
function getCredentialsFromParams(params: unknown): Credentials | null {
  // Type guard: params must be an object
  if (!params || typeof params !== "object") {
    return null;
  }

  const missing = [
    "token" in params && typeof params.token === "string" ? null : "token",
    "teamId" in params && typeof params.teamId === "string" ? null : "teamId",
    "projectId" in params && typeof params.projectId === "string"
      ? null
      : "projectId",
  ].filter((value) => value !== null);

  if (missing.length === 0) {
    return {
      token: (params as any).token,
      projectId: (params as any).projectId,
      teamId: (params as any).teamId,
    };
  }

  if (missing.length < 3) {
    throw new Error(
      `Missing credentials parameters to access the Vercel API: ${missing
        .filter((value) => value !== null)
        .join(", ")}`,
    );
  }

  return null;
}

/**
 * Schema to validate the payload of the Vercel OIDC token where we expect
 * to find the `teamId` and `projectId`.
 */
export const schema = z.object({
  exp: z.number().optional().describe("Expiry timestamp (seconds since epoch)"),
  iat: z.number().optional().describe("Issued at timestamp"),
  owner_id: z.string(),
  project_id: z.string(),
});

/**
 * Extracts credentials from a Vercel OIDC token. The token is expected to be
 * a JWT with a payload that contains `project_id` and `owner_id`.
 *
 * @param token - The Vercel OIDC token.
 * @returns An object containing the token, projectId, and teamId.
 * @throws If the token is invalid or does not contain the required fields.
 */
function getCredentialsFromOIDCToken(token: string): Credentials {
  try {
    const payload = schema.parse(decodeBase64Url(token.split(".")[1]));
    return {
      token,
      projectId: payload.project_id,
      teamId: payload.owner_id,
    };
  } catch (error) {
    throw new Error(
      `Invalid Vercel OIDC token: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
