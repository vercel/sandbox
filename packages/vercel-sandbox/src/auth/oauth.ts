import os from "os";
import { z } from "zod";
import { VERSION } from "../version";

const USER_AGENT = `${os.hostname()} @ vercel/sandbox/${VERSION} node-${
  process.version
} ${os.platform()} (${os.arch()})`;

const ISSUER = new URL("https://vercel.com");
const CLIENT_ID = "cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp";

const AuthorizationServerMetadata = z.object({
  issuer: z.string().url(),
  device_authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  revocation_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  introspection_endpoint: z.string().url(),
});
type AuthorizationServerMetadata = z.infer<typeof AuthorizationServerMetadata>;
let _as: AuthorizationServerMetadata;

const DeviceAuthorization = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url(),
  expires_in: z.number(),
  interval: z.number(),
});

const IntrospectionResponse = z
  .object({
    active: z.literal(true),
    client_id: z.string(),
    session_id: z.string(),
  })
  .or(z.object({ active: z.literal(false) }));

/**
 * Returns the Authorization Server Metadata
 *
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationRequest
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationResponse
 */
async function authorizationServerMetadata(): Promise<AuthorizationServerMetadata> {
  if (_as) return _as;

  const response = await fetch(
    new URL(".well-known/openid-configuration", ISSUER),
    {
      headers: { "Content-Type": "application/json", "user-agent": USER_AGENT },
    },
  );

  _as = AuthorizationServerMetadata.parse(await response.json());
  return _as;
}

export async function OAuth() {
  const as = await authorizationServerMetadata();
  return {
    /**
     * Perform the Device Authorization Request
     *
     * @see https://datatracker.ietf.org/doc/html/rfc8628#section-3.1
     * @see https://datatracker.ietf.org/doc/html/rfc8628#section-3.2
     */
    async deviceAuthorizationRequest(): Promise<DeviceAuthorizationRequest> {
      const response = await fetch(as.device_authorization_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "user-agent": USER_AGENT,
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          scope: "openid offline_access",
        }),
      });

      const json = await response.json();
      const parsed = DeviceAuthorization.safeParse(json);

      if (!parsed.success) {
        throw new OAuthError(
          `Failed to parse device authorization response: ${parsed.error.message}`,
          json,
        );
      }

      return {
        device_code: parsed.data.device_code,
        user_code: parsed.data.user_code,
        verification_uri: parsed.data.verification_uri,
        verification_uri_complete: parsed.data.verification_uri_complete,
        expiresAt: Date.now() + parsed.data.expires_in * 1000,
        interval: parsed.data.interval,
      };
    },
    /**
     * Perform the Device Access Token Request
     *
     * @see https://datatracker.ietf.org/doc/html/rfc8628#section-3.4
     */
    async deviceAccessTokenRequest(
      device_code: string,
    ): Promise<[Error] | [null, Response]> {
      try {
        return [
          null,
          await fetch(as.token_endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "user-agent": USER_AGENT,
            },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
              device_code,
            }),
            signal: AbortSignal.timeout(10 * 1000),
          }),
        ];
      } catch (error) {
        if (error instanceof Error) return [error];
        return [
          new Error("An unknown error occurred. See the logs for details.", {
            cause: error,
          }),
        ];
      }
    },
    /**
     * Process the Token request Response
     *
     * @see https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
     */
    async processTokenResponse(
      response: Response,
    ): Promise<[OAuthError] | [null, TokenSet]> {
      const json = await response.json();
      const processed = TokenSet.safeParse(json);

      if (!processed.success) {
        return [
          new OAuthError(
            `Failed to parse token response: ${processed.error.message}`,
            json,
          ),
        ];
      }

      return [null, processed.data];
    },
    /**
     * Perform a Token Revocation Request.
     *
     * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.1
     * @see https://datatracker.ietf.org/doc/html/rfc7009#section-2.2
     */
    async revokeToken(token: string): Promise<OAuthError | void> {
      const response = await fetch(as.revocation_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "user-agent": USER_AGENT,
        },
        body: new URLSearchParams({ token, client_id: CLIENT_ID }),
      });

      if (response.ok) return;
      const json = await response.json();

      return new OAuthError("Revocation request failed", json);
    },
    /**
     * Perform Refresh Token Request.
     *
     * @see https://datatracker.ietf.org/doc/html/rfc6749#section-6
     */
    async refreshToken(token: string): Promise<TokenSet> {
      const response = await fetch(as.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "user-agent": USER_AGENT,
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: token,
        }),
      });

      const [tokensError, tokenSet] = await this.processTokenResponse(response);
      if (tokensError) throw tokensError;
      return tokenSet;
    },
    /**
     * Perform Token Introspection Request.
     *
     * @see https://datatracker.ietf.org/doc/html/rfc7662#section-2.1
     */
    async introspectToken(
      token: string,
    ): Promise<z.infer<typeof IntrospectionResponse>> {
      const response = await fetch(as.introspection_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "user-agent": USER_AGENT,
        },
        body: new URLSearchParams({ token }),
      });

      const json = await response.json();
      const processed = IntrospectionResponse.safeParse(json);
      if (!processed.success) {
        throw new OAuthError(
          `Failed to parse introspection response: ${processed.error.message}`,
          json,
        );
      }

      return processed.data;
    },
  };
}

export type OAuth = Awaited<ReturnType<typeof OAuth>>;

const TokenSet = z.object({
  /** The access token issued by the authorization server. */
  access_token: z.string(),
  /** The type of the token issued */
  token_type: z.literal("Bearer"),
  /** The lifetime in seconds of the access token. */
  expires_in: z.number(),
  /** The refresh token, which can be used to obtain new access tokens. */
  refresh_token: z.string().optional(),
  /** The scope of the access token. */
  scope: z.string().optional(),
});

type TokenSet = z.infer<typeof TokenSet>;

const OAuthErrorResponse = z.object({
  error: z.enum([
    "invalid_request",
    "invalid_client",
    "invalid_grant",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_scope",
    "server_error",
    // Device Authorization Response Errors
    "authorization_pending",
    "slow_down",
    "access_denied",
    "expired_token",
    // Revocation Response Errors
    "unsupported_token_type",
  ]),
  error_description: z.string().optional(),
  error_uri: z.string().optional(),
});

type OAuthErrorResponse = z.infer<typeof OAuthErrorResponse>;

function processOAuthErrorResponse(
  json: unknown,
): OAuthErrorResponse | TypeError {
  try {
    return OAuthErrorResponse.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new TypeError(`Invalid OAuth error response: ${error.message}`);
    }
    return new TypeError("Failed to parse OAuth error response");
  }
}

class OAuthError extends Error {
  name = "OAuthError";
  code: OAuthErrorResponse["error"];
  cause: Error;
  constructor(message: string, response: unknown) {
    super(message);
    const error = processOAuthErrorResponse(response);
    if (error instanceof TypeError) {
      const message = `Unexpected server response: ${JSON.stringify(response)}`;
      this.cause = new Error(message, { cause: error });
      this.code = "server_error";
      return;
    }
    let cause = error.error;
    if (error.error_description) cause += `: ${error.error_description}`;
    if (error.error_uri) cause += ` (${error.error_uri})`;

    this.cause = new Error(cause);
    this.code = error.error;
  }
}

export function isOAuthError(error: unknown): error is OAuthError {
  return error instanceof OAuthError;
}

export interface DeviceAuthorizationRequest {
  /** The device verification code. */
  device_code: string;
  /** The end-user verification code. */
  user_code: string;
  /**
   * The minimum amount of time in seconds that the client
   * SHOULD wait between polling requests to the token endpoint.
   */
  interval: number;
  /** The end-user verification URI on the authorization server. */
  verification_uri: string;
  /**
   * The end-user verification URI on the authorization server,
   * including the `user_code`, without redirection.
   */
  verification_uri_complete: string;
  /**
   * The absolute lifetime of the `device_code` and `user_code`.
   * Calculated from `expires_in`.
   */
  expiresAt: number;
}
