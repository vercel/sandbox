import type { AuthHeadersProvider } from "@vercel/sandbox";

let provider: AuthHeadersProvider | undefined;

/**
 * Authenticate API requests with `getAuthHeaders` instead of a token, such as
 * the Vercel CLI signing a DPoP proof for each request. A token from `--token`
 * or `VERCEL_AUTH_TOKEN` still takes precedence.
 */
export function setAuthHeadersProvider(
  getAuthHeaders: AuthHeadersProvider | undefined,
): void {
  provider = getAuthHeaders;
}

export function hasAuthHeadersProvider(): boolean {
  return provider !== undefined;
}

/**
 * The provider to authenticate a request with `token`: only when there's no
 * token, which is what the `--token` option resolves to when a provider is
 * set and no token was given.
 */
export function authHeadersFor(
  token: string | undefined,
): AuthHeadersProvider | undefined {
  return token ? undefined : provider;
}
