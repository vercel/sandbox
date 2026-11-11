import { BaseClient, type RequestParams } from "./base-client.js";
import type { SDKConfig } from "../config.js";
import type { APIError } from "./api-error.js";
import os from "os";
import { getVercelOidcToken } from "@vercel/oidc";
import { detectAgentName } from "../utils/detect-agent.js";

interface Claims {
  owner_id: string;
  project_id?: string;
  /** Expiry as a Unix timestamp in seconds, when present. */
  exp?: number;
}

/**
 * Refresh an OIDC token once it is within this window of expiring. Until then
 * the token we hold is reused without consulting `@vercel/oidc` again.
 */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function expiresAtMs(claims: Claims): number | undefined {
  return claims.exp !== undefined ? claims.exp * 1000 : undefined;
}

function decodeUnverifiedToken(token: string): Claims | null {
  if (token.split(".").length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    if (payload.owner_id) {
      return {
        owner_id: payload.owner_id,
        project_id: payload.project_id,
        exp: typeof payload.exp === "number" ? payload.exp : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export interface WithFetchOptions {
  fetch?: typeof globalThis.fetch;
}

export class AuthenticatedClient extends BaseClient {
  private config: SDKConfig;
  private teamId: string;
  private projectId: string | undefined;
  private isJwtToken: boolean;
  /** When the current JWT expires, in epoch ms; unknown if undefined. */
  private tokenExpiresAt: number | undefined;
  /** In-flight refresh, shared by concurrent requests. */
  private tokenRefresh: Promise<void> | undefined;

  constructor(params: {
    config: SDKConfig;
    apiError: typeof APIError;
    baseUrl?: string;
    teamId: string;
    token: string;
    fetch?: typeof globalThis.fetch;
  }) {
    super({
      // Call the API host directly: `vercel.com/api` adds an extra edge hop.
      baseUrl: params.baseUrl ?? "https://api.vercel.com",
      token: params.token,
      debug: false,
      fetch: params.fetch,
      apiError: params.apiError,
    });

    this.config = params.config;
    this.teamId = params.teamId;
    this.isJwtToken = false;

    const claims = decodeUnverifiedToken(params.token);
    if (claims) {
      this.isJwtToken = true;
      this.projectId = claims.project_id;
      this.teamId = claims.owner_id;
      this.tokenExpiresAt = expiresAtMs(claims);
    }
  }

  /**
   * Make sure the OIDC token is not about to expire before a request.
   *
   * This runs before every request, so it only consults `@vercel/oidc` (which
   * may read a token file and decode the JWT) once the token we hold is within
   * {@link TOKEN_REFRESH_BUFFER_MS} of expiring, or when its expiry is unknown.
   * Concurrent requests share a single refresh.
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.isJwtToken) {
      return;
    }

    if (
      this.tokenExpiresAt !== undefined &&
      this.tokenExpiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS
    ) {
      return;
    }

    this.tokenRefresh ??= this.refreshToken().finally(() => {
      this.tokenRefresh = undefined;
    });
    return this.tokenRefresh;
  }

  private async refreshToken(): Promise<void> {
    try {
      // Use getVercelOidcToken to refresh the token with team/project scope
      const freshToken = await getVercelOidcToken({
        expirationBufferMs: TOKEN_REFRESH_BUFFER_MS,
        team: this.teamId,
        project: this.projectId,
      });

      // Update token if it changed
      if (freshToken !== this.token) {
        this.token = freshToken;

        const claims = decodeUnverifiedToken(freshToken);
        if (claims) {
          this.teamId = claims.owner_id;
          this.tokenExpiresAt = expiresAtMs(claims);
        }
      }
    } catch {
      // Ignore refresh errors and continue with current token
    }
  }

  protected async request(path: string, params?: RequestParams) {
    await this.ensureValidToken();

    // Attribute traffic to the AI agent driving this process, if any, so the
    // server side can record it once ingestion support lands.
    const aiAgent = await detectAgentName(this.config.telemetryDisabledEnv);
    const agentSuffix = aiAgent ? ` agent/${aiAgent}` : "";

    return super.request(path, {
      ...params,
      query: { teamId: this.teamId, ...params?.query },
      headers: {
        "content-type": "application/json",
        "user-agent": `${this.config.name}/${this.config.version}${agentSuffix} (Node.js/${process.version}; ${os.platform()}/${os.arch()})`,
        ...params?.headers,
      },
    });
  }
}
