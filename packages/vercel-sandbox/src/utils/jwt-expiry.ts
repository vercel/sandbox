import { z } from "zod";
import { decodeBase64Url } from "./decode-base64-url";
import { schema } from "./get-credentials";
import { getVercelOidcToken } from "@vercel/oidc";
import ms from "ms";

/** Time buffer before token expiry to consider it invalid (in milliseconds) */
const BUFFER_MS = ms("5m");

export class OidcRefreshError extends Error {
  name = "OidcRefreshError";
}

/**
 * Expiry implementation for JWT tokens (OIDC tokens).
 * Parses the JWT once and provides fast expiry validation.
 */
export class JwtExpiry {
  private expiryTime: number | null; // Unix timestamp in seconds
  readonly payload?: Readonly<z.infer<typeof schema>>;

  static fromToken(token: string): JwtExpiry | null {
    if (!isJwtFormat(token)) {
      return null;
    } else {
      return new JwtExpiry(token);
    }
  }

  /**
   * Creates a new JWT expiry checker.
   *
   * @param token - The JWT token to parse
   */
  constructor(readonly token: string) {
    try {
      const tokenContents = token.split(".")[1];
      this.payload = schema.parse(decodeBase64Url(tokenContents));
      this.expiryTime = this.payload.exp || null;
    } catch {
      // Malformed token - treat as expired to trigger refresh
      this.expiryTime = 0;
    }
  }

  /**
   * Checks if the JWT token is valid (not expired).
   * @returns true if token is valid, false if expired or expiring soon
   */
  isValid(): boolean {
    if (this.expiryTime === null) {
      return false; // No expiry means malformed JWT
    }

    const now = Math.floor(Date.now() / 1000);
    const buffer = BUFFER_MS / 1000;
    return now + buffer < this.expiryTime;
  }

  /**
   * Gets the expiry date of the JWT token.
   *
   * @returns Date object representing when the token expires, or null if no expiry
   */
  getExpiryDate(): Date | null {
    return this.expiryTime ? new Date(this.expiryTime * 1000) : null;
  }

  /**
   * Refreshes the JWT token by fetching a new OIDC token.
   *
   * @returns Promise resolving to a new JwtExpiry instance with fresh token
   */
  async refresh(): Promise<JwtExpiry> {
    try {
      const freshToken = await getVercelOidcToken();
      return new JwtExpiry(freshToken);
    } catch (cause) {
      throw new OidcRefreshError("Failed to refresh OIDC token", {
        cause,
      });
    }
  }

  /**
   * Refreshes the JWT token if it's expired or expiring soon.
   */
  async tryRefresh(): Promise<JwtExpiry | null> {
    if (this.isValid()) {
      return null; // Still valid, no need to refresh
    }

    return this.refresh();
  }
}

/**
 * Checks if a token follows JWT format (has 3 parts separated by dots).
 *
 * @param token - The token to check
 * @returns true if token appears to be a JWT, false otherwise
 */
function isJwtFormat(token: string): boolean {
  return token.split(".").length === 3;
}
