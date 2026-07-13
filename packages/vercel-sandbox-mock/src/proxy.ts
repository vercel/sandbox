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
  host: string;
  teamId: string;
  projectId: string;
  sandboxId: string;
  sandboxName: string;
}

export type ProxyHandler = (request: Request, meta: ProxyMeta) => Response | Promise<Response>;

export type InvalidRequestProxyHandler = (
  request: Request,
  error: Error,
) => Response | Promise<Response>;

/**
 * Creates a test handler for requests forwarded by a Vercel Sandbox.
 * Forwarded OIDC tokens are verified against the issuer's remote JWK set,
 * matching the production SDK's authorization behavior.
 */
export function defineSandboxProxy(
  handler: ProxyHandler,
  invalidRequestHandler: InvalidRequestProxyHandler = defaultInvalidRequestHandler,
): (request: Request) => Promise<Response> {
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
        new Request(request, { headers }),
        new Error("Missing required proxy headers"),
      );
    }

    let sanitizedRequest: Request;
    try {
      const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers,
      };
      if (request.body) {
        init.body = request.body;
        init.duplex = "half";
      }
      sanitizedRequest = new Request(`${scheme}://${host}:${port}${path}`, init);
      sanitizedRequest.headers.set("host", host);
    } catch {
      return invalidRequestHandler(
        new Request(request, { headers }),
        new Error("Invalid proxied request URL"),
      );
    }

    try {
      const originalUrl = normalizeForwardUrl(new URL(request.url), path);
      const claims = await verifyOidcToken(oidcToken, originalUrl);
      return handler(sanitizedRequest, getProxyMeta(originalUrl.host, claims));
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

async function verifyOidcToken(token: string, originalUrl: URL): Promise<Record<string, unknown>> {
  const claims = decodeJwt(token);
  const issuer = getClaim(claims, "iss");
  if (!issuer) throw new Error("Missing OIDC issuer");

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error("Invalid OIDC issuer");
  }
  if (issuerUrl.protocol !== "https:" || issuerUrl.hostname !== VERCEL_OIDC_HOSTNAME) {
    throw new Error("Invalid OIDC issuer");
  }

  const { payload } = await jwtVerify(token, getJwks(issuer), {
    audience: getForwardUrlAudience(originalUrl),
    algorithms: ["RS256"],
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
    issuer,
  });
  return payload;
}

function getForwardUrlAudience(url: URL): string {
  const pathname = stripTrailingPathSlash(url.pathname);
  return pathname === "/" ? url.origin : url.origin + pathname;
}

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(issuer);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks`));
  jwksCache.set(issuer, jwks);
  return jwks;
}

function normalizeForwardUrl(url: URL, forwardedPath: string): URL {
  const forwardedUrl = new URL(forwardedPath, url.origin);
  const forwardedPathname = stripTrailingPathSlash(forwardedUrl.pathname);
  const normalizedUrl = new URL(url);
  normalizedUrl.pathname = stripTrailingPathSlash(normalizedUrl.pathname);
  if (forwardedPathname !== "/" && normalizedUrl.pathname.endsWith(forwardedPathname)) {
    normalizedUrl.pathname = stripTrailingPathSlash(
      normalizedUrl.pathname.slice(0, -forwardedPathname.length),
    );
  }
  return normalizedUrl;
}

function stripTrailingPathSlash(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function getProxyMeta(host: string, claims: Record<string, unknown>): ProxyMeta {
  const teamId = getClaim(claims, "team_id");
  const projectId = getClaim(claims, "project_id");
  const sandboxId = getClaim(claims, "sandbox_id");
  const sandboxName = getClaim(claims, "sandbox_name") ?? sandboxId;
  if (!teamId || !projectId || !sandboxId || !sandboxName) {
    throw new Error("Missing required claims in OIDC token");
  }
  return { host, teamId, projectId, sandboxId, sandboxName };
}

function getClaim(claims: Record<string, unknown>, name: string): string | undefined {
  const value = claims[name];
  return typeof value === "string" && value ? value : undefined;
}
