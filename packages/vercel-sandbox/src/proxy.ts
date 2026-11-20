import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { LRUCache } from "lru-cache";

const FORWARDED_HOST_HEADER = "vercel-forwarded-host";
const FORWARDED_SCHEME_HEADER = "vercel-forwarded-scheme";
const FORWARDED_PORT_HEADER = "vercel-forwarded-port";
const FORWARDED_PATH_HEADER = "vercel-forwarded-path";
const SANDBOX_OIDC_TOKEN_HEADER = "vercel-sandbox-oidc-token";

const VERCEL_OIDC_HOSTNAME = "oidc.vercel.com";
const CLOCK_TOLERANCE_SECONDS = 60;
const MAX_JWKS_CACHE_SIZE = 100;
const OWN_SOURCE_RETRY_DELAY_MS = 60_000;
const REQUEST_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

const jwksCache = new LRUCache<string, ReturnType<typeof createRemoteJWKSet>>({
  max: MAX_JWKS_CACHE_SIZE,
});

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

interface BaseSandboxProxyOptions {
  /**
   * Called when a request is rejected, including when the source sandbox is not allowed.
   * By default, a 403 response is returned.
   */
  onInvalidRequest?: InvalidRequestProxyHandler;
}

interface AllowedSandboxProxyOptions extends BaseSandboxProxyOptions {
  /**
   * Other team IDs whose sandboxes may use this proxy, on top of the proxy's own team.
   * A sandbox is allowed when its team is in the allowed teams and its project is in the allowed projects.
   */
  teamId?: string | readonly string[];
  /**
   * Other project IDs whose sandboxes may use this proxy, on top of the proxy's own project.
   * A sandbox is allowed when its team is in the allowed teams and its project is in the allowed projects.
   */
  projectId?: string | readonly string[];
  dangerouslyAllowAll?: never;
}

interface DangerouslyAllowAllSandboxProxyOptions
  extends BaseSandboxProxyOptions {
  /**
   * Accept proxied requests from sandboxes of any Vercel team or project. Not recommended.
   */
  dangerouslyAllowAll: true;
  teamId?: never;
  projectId?: never;
}

export type SandboxProxyOptions =
  | AllowedSandboxProxyOptions
  | DangerouslyAllowAllSandboxProxyOptions;

/**
 * Creates a Web Handler for proxied requests from Vercel Sandboxes using the network policy `forwardURL`
 * option. The provided `handler` is called for each valid proxied request, with the original request
 * alongside extracted metadata used to identify the source sandbox and request details.
 *
 * This function automatically verifies the OIDC token included in proxied requests, and only accepts
 * requests from sandboxes owned by the proxy's own team and project (read from its Vercel OIDC token),
 * plus any `teamId` and `projectId` you pass. If a request is rejected, `onInvalidRequest` is called
 * (by default, a 403 response is returned).
 *
 * Any sandbox in an allowed team and project can use the proxy. If only some of them should, check
 * `meta.sandboxId` or `meta.sandboxName` in the handler. Sandbox names are only unique within a project,
 * so also check `meta.projectId` when more than one project is allowed.
 *
 * @example
 * ```ts
 * const allowedSandboxes = new Set(["my-sandbox"])
 *
 * export default {
 *   fetch: defineSandboxProxy(async (request, meta) => {
 *     // meta contains the original host & source team/project/sandbox ids
 *     if (!allowedSandboxes.has(meta.sandboxName)) {
 *       return new Response("Forbidden", { status: 403 })
 *     }
 *
 *     // return a custom response, or proxy upstream:
 *     return await fetch(request)
 *   })
 * }
 * ```
 *
 * @see https://vercel.com/docs/vercel-sandbox/concepts/firewall#requests-proxying
 */
export function defineSandboxProxy(
  handler: ProxyHandler,
  options: SandboxProxyOptions = {},
) {
  const isAllowed = getSourceAllowlist(options);
  const invalidRequestHandler =
    options.onInvalidRequest ?? defaultInvalidRequestHandler;

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
      sanitizedRequest = new Request(
        getProxiedRequestUrl(scheme, host, port, path),
        {
          method: request.method,
          body: request.body,
          headers,
          duplex: "half",
        },
      );
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

      if (!(await isAllowed(meta))) {
        throw new Error("Sandbox is not allowed to use this proxy");
      }

      return handler(sanitizedRequest, meta);
    } catch (error) {
      return invalidRequestHandler(
        sanitizedRequest,
        error instanceof Error ? error : new Error("Invalid OIDC token"),
      );
    }
  };
}

function getSourceAllowlist(
  options: SandboxProxyOptions,
): (meta: ProxyMeta) => Promise<boolean> {
  if (typeof options === "function") {
    throw new Error(
      "defineSandboxProxy now takes an options object as its second argument: move the invalid request handler to `onInvalidRequest`",
    );
  }

  if (!options || typeof options !== "object") {
    throw new Error("defineSandboxProxy options must be an object");
  }

  const hasAllowlist =
    options.teamId !== undefined || options.projectId !== undefined;

  if (options.dangerouslyAllowAll !== undefined) {
    if (options.dangerouslyAllowAll !== true || hasAllowlist) {
      throw new Error(
        "defineSandboxProxy `dangerouslyAllowAll` must be `true` and cannot be combined with `teamId` or `projectId`",
      );
    }
    return async () => true;
  }

  if (
    hasAllowlist &&
    (options.teamId === undefined || options.projectId === undefined)
  ) {
    throw new Error(
      "defineSandboxProxy `teamId` and `projectId` must be passed together",
    );
  }

  const teamIds = hasAllowlist
    ? toIdSet(options.teamId, "teamId")
    : new Set<string>();
  const projectIds = hasAllowlist
    ? toIdSet(options.projectId, "projectId")
    : new Set<string>();
  const ownSource = createOwnSourceLookup();

  return async (meta) => {
    let own: SourceIds | undefined;

    try {
      own = await ownSource();
    } catch (error) {
      if (!hasAllowlist) {
        throw new Error(
          "Could not determine this proxy's team and project from its Vercel OIDC token. Make sure OIDC is enabled (locally, re-run `vercel env pull`), or pass `teamId` and `projectId`",
          { cause: error },
        );
      }
    }

    const teamAllowed = teamIds.has(meta.teamId) || own?.teamId === meta.teamId;
    const projectAllowed =
      projectIds.has(meta.projectId) || own?.projectId === meta.projectId;

    return teamAllowed && projectAllowed;
  };
}

interface SourceIds {
  teamId: string;
  projectId: string;
}

function createOwnSourceLookup(): () => Promise<SourceIds> {
  let pending: Promise<SourceIds> | undefined;
  let failedAt: number | undefined;
  let lastError: unknown;

  return () => {
    if (
      failedAt !== undefined &&
      Date.now() - failedAt < OWN_SOURCE_RETRY_DELAY_MS
    ) {
      return Promise.reject(lastError);
    }

    if (!pending) {
      pending = getOwnSource().then(
        (source) => {
          failedAt = undefined;
          return source;
        },
        (error: unknown) => {
          pending = undefined;
          failedAt = Date.now();
          lastError = error;
          throw error;
        },
      );
    }

    return pending;
  };
}

async function getOwnSource(): Promise<SourceIds> {
  const expectedProjectId = process.env.VERCEL_PROJECT_ID;

  if (!expectedProjectId) {
    throw new Error("VERCEL_PROJECT_ID is not set");
  }

  const token = getOwnOidcToken();

  if (!token) {
    throw new Error("No Vercel OIDC token is available");
  }

  const payload = await verifyVercelIssuedToken(token);
  const teamId = getClaim(payload, "owner_id");
  const projectId = getClaim(payload, "project_id");

  if (!teamId || projectId !== expectedProjectId) {
    throw new Error(
      "Vercel OIDC token does not belong to this deployment's team and project",
    );
  }

  return { teamId, projectId };
}

// Mirrors `getVercelOidcTokenSync` from `@vercel/oidc`, whose CommonJS build breaks `require`-less bundles like Workflow functions.
function getOwnOidcToken(): string | undefined {
  const requestContext = (
    globalThis as {
      [REQUEST_CONTEXT_SYMBOL]?: {
        get?: () => { headers?: Record<string, string | undefined> };
      };
    }
  )[REQUEST_CONTEXT_SYMBOL]?.get?.();

  return (
    requestContext?.headers?.["x-vercel-oidc-token"] ??
    process.env.VERCEL_OIDC_TOKEN
  );
}

function toIdSet(value: unknown, name: string): Set<string> {
  const ids: unknown[] = Array.isArray(value) ? Array.from(value) : [value];

  if (
    ids.length === 0 ||
    !ids.every((id): id is string => typeof id === "string" && id !== "")
  ) {
    throw new Error(
      `defineSandboxProxy \`${name}\` must be a non-empty string or array of non-empty strings`,
    );
  }

  return new Set(ids);
}

function defaultInvalidRequestHandler(): Response {
  return new Response("Forbidden", { status: 403 });
}

function getProxiedRequestUrl(
  scheme: string,
  host: string,
  port: string,
  path: string,
): string {
  const origin = `${scheme}://${host}:${port}`;

  return path === "/" ? origin : `${origin}${path}`;
}

function normalizeForwardUrl(url: URL, forwardedPath: string): URL {
  const forwardedUrl = new URL(forwardedPath, url.origin);
  const forwardedPathname = stripTrailingPathSlash(forwardedUrl.pathname);
  const normalizedUrl = new URL(url);
  normalizedUrl.pathname = stripTrailingPathSlash(normalizedUrl.pathname);

  if (
    forwardedPathname !== "/" &&
    normalizedUrl.pathname.endsWith(forwardedPathname)
  ) {
    normalizedUrl.pathname = stripTrailingPathSlash(
      normalizedUrl.pathname.slice(0, -forwardedPathname.length),
    );
  }

  return normalizedUrl;
}

function stripTrailingPathSlash(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
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
  return verifyVercelIssuedToken(token, getForwardUrlAudience(originalUrl));
}

async function verifyVercelIssuedToken(
  token: string,
  audience?: string,
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
    issuerUrl.hostname !== VERCEL_OIDC_HOSTNAME ||
    issuerUrl.port !== "" ||
    issuerUrl.username !== "" ||
    issuerUrl.password !== "" ||
    issuerUrl.search !== "" ||
    issuerUrl.hash !== "" ||
    issuer.includes("?") ||
    issuer.includes("#") ||
    !/^\/[^/]*$/.test(issuerUrl.pathname)
  ) {
    throw new Error("Invalid OIDC issuer");
  }

  const { payload } = await jwtVerify(token, getJwks(issuer), {
    audience,
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
