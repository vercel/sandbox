import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

const FORWARDED_HOST_HEADER = "vercel-forwarded-host";
const FORWARDED_SCHEME_HEADER = "vercel-forwarded-scheme";
const FORWARDED_PORT_HEADER = "vercel-forwarded-port";
const FORWARDED_PATH_HEADER = "vercel-forwarded-path";
const SANDBOX_OIDC_TOKEN_HEADER = "vercel-sandbox-oidc-token";

const VERCEL_OIDC_HOSTNAME = "oidc.vercel.com";
const CLOCK_TOLERANCE_SECONDS = 60;

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface ProxyMeta {
  /**
   * The host of the request as received by this proxy.
   */
  host: string;
  /**
   * The ID of the team that owns the sandbox that proxied the request.
   */
  teamId: string;
  /**
   * The ID of the project that owns the sandbox that proxied the request.
   */
  projectId: string;
  /**
   * The ID of the sandbox that proxied the request.
   */
  sandboxId: string;
  /**
   * The name of the sandbox that proxied the request, when using persistent sandboxes.
   */
  sandboxName: string;
}

export type ProxyHandler = (
  request: Request,
  meta: ProxyMeta,
) => Response | Promise<Response>;

export type InvalidRequestProxyHandler = (
  request: Request,
  error: Error,
) => Response | Promise<Response>;

/**
 * Creates a Web Handler for proxied requests from Vercel Sandboxes using the network policy `forwardURL`
 * option. The provided `handler` is called for each valid proxied request, with the original request
 * alongside extracted metadata used to identify the source sandbox and request details.
 *
 * This function automatically verifies the OIDC token included in proxied requests to ensure the request
 * is legitimate: if invalid, the `invalidRequestHandler` is called (by default, a 403 response is returned).
 *
 * @example
 * ```ts
 * export default {
 *   fetch: defineSandboxProxy(async (request, meta) => {
 *     // meta contains the original host & source team/project/sandbox ids
 *     console.log(meta)
 *
 *     // return a custom response, or proxy upstream:
 *     return await fetch(request)
 *   }, (request, error) => {
 *     // optional, handle any authorization error
 *     return new Response("Forbidden", { status: 403 })
 *   })
 * }
 * ```
 *
 * @see https://vercel.com/docs/vercel-sandbox/concepts/firewall#requests-proxying
 */
export function defineSandboxProxy(
  handler: ProxyHandler,
  invalidRequestHandler: InvalidRequestProxyHandler = defaultInvalidRequestHandler,
) {
  return async function sandboxProxy(request: Request): Promise<Response> {
    const headers = new Headers(request.headers);
    const host = headers.get(FORWARDED_HOST_HEADER);
    const scheme = headers.get(FORWARDED_SCHEME_HEADER);
    const port = headers.get(FORWARDED_PORT_HEADER);
    const path = headers.get(FORWARDED_PATH_HEADER);
    const oidcToken = headers.get(SANDBOX_OIDC_TOKEN_HEADER);

    headers.delete(FORWARDED_HOST_HEADER);
    headers.delete(FORWARDED_SCHEME_HEADER);
    headers.delete(FORWARDED_PORT_HEADER);
    headers.delete(FORWARDED_PATH_HEADER);
    headers.delete(SANDBOX_OIDC_TOKEN_HEADER);

    if (!host || !scheme || !port || !path || !oidcToken) {
      return invalidRequestHandler(
        request,
        new Error("Missing required proxy headers"),
      );
    }

    let sanitizedRequest: Request;

    try {
      sanitizedRequest = new Request(`${scheme}://${host}:${port}${path}`, {
        method: request.method,
        body: request.body,
        headers,
        duplex: "half",
      });
    } catch {
      return invalidRequestHandler(
        new Request(request, { headers }),
        new Error("Invalid proxied request URL"),
      );
    }

    sanitizedRequest.headers.set("host", host);

    try {
      const originalUrl = normalizeForwardUrl(new URL(request.url), path);
      const claims = await verifyOidcToken(oidcToken, originalUrl);
      const meta = getProxyMeta(originalUrl.host, claims);

      return handler(sanitizedRequest, meta);
    } catch (error) {
      return invalidRequestHandler(
        sanitizedRequest,
        error instanceof Error ? error : new Error("Invalid OIDC token"),
      );
    }
  };
}

function defaultInvalidRequestHandler(): Response {
  return new Response("Forbidden", { status: 403 });
}

function normalizeForwardUrl(url: URL, forwardedPath: string): URL {
  const forwardedUrl = new URL(forwardedPath, url.origin);
  const forwardedPathname = forwardedUrl.pathname;
  const normalizedUrl = new URL(url);

  if (
    forwardedPathname !== "/" &&
    normalizedUrl.pathname.endsWith(forwardedPathname)
  ) {
    normalizedUrl.pathname =
      normalizedUrl.pathname.slice(0, -forwardedPathname.length) || "/";
  }

  return normalizedUrl;
}

function getProxyMeta(
  host: string,
  claims: Record<string, unknown>,
): ProxyMeta {
  const teamId = getClaim(claims, "team_id");
  const projectId = getClaim(claims, "project_id");
  const sandboxId = getClaim(claims, "sandbox_id");
  const sandboxName = getClaim(claims, "sandbox_name") ?? sandboxId;

  if (!teamId || !projectId || !sandboxId || !sandboxName) {
    throw new Error("Missing required claims in OIDC token");
  }

  return {
    host,
    teamId,
    projectId,
    sandboxId,
    sandboxName,
  };
}

async function verifyOidcToken(
  token: string,
  originalUrl: URL,
): Promise<Record<string, unknown>> {
  const claims = decodeJwt(token);
  const issuer = getClaim(claims, "iss");

  if (!issuer) {
    throw new Error("Missing OIDC issuer");
  }

  let issuerUrl: URL;

  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error("Invalid OIDC issuer");
  }

  if (
    issuerUrl.protocol !== "https:" ||
    issuerUrl.hostname !== VERCEL_OIDC_HOSTNAME
  ) {
    throw new Error("Invalid OIDC issuer");
  }

  const { payload } = await jwtVerify(token, getJwks(issuer), {
    audience: getForwardUrlAudiences(originalUrl),
    algorithms: ["RS256"],
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
    issuer,
  });

  return payload;
}

function getForwardUrlAudiences(url: URL): string | string[] {
  if (url.pathname === "/") {
    return [url.origin, `${url.origin}/`];
  }

  return url.origin + url.pathname;
}

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(issuer);

  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(
    new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks`),
  );

  jwksCache.set(issuer, jwks);

  return jwks;
}

function getClaim(
  claims: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = claims[name];

  if (typeof value === "string" && value) {
    return value;
  }
}
