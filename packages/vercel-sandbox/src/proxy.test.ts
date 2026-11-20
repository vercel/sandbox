import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { defineSandboxProxy } from "./proxy.js";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  decodeJwt: vi.fn(),
  jwtVerify: vi.fn(),
}));

const createRemoteJWKSetMock = vi.mocked(createRemoteJWKSet);
const decodeJwtMock = vi.mocked(decodeJwt);
const jwtVerifyMock = vi.mocked(jwtVerify);
const OWN_TOKEN = "own_token";

let ownTokenResult: () => Promise<Awaited<ReturnType<typeof jwtVerify>>>;
let sandboxTokenResult: () => Promise<Awaited<ReturnType<typeof jwtVerify>>>;

function mockOwnSource(payload: Record<string, unknown>) {
  ownTokenResult = async () => makeJwtVerifyResult(payload);
  if (typeof payload.project_id === "string") {
    vi.stubEnv("VERCEL_PROJECT_ID", payload.project_id);
  }
}

function mockOwnSourceError(error: Error) {
  ownTokenResult = async () => {
    throw error;
  };
}

function mockSandboxToken(result: Awaited<ReturnType<typeof jwtVerify>>) {
  sandboxTokenResult = async () => result;
}

function mockSandboxTokenError(error: Error) {
  sandboxTokenResult = async () => {
    throw error;
  };
}

function ownTokenVerifications(): number {
  return jwtVerifyMock.mock.calls.filter(([token]) => token === OWN_TOKEN)
    .length;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.resetAllMocks();

  createRemoteJWKSetMock.mockReturnValue(
    vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>,
  );
  decodeJwtMock.mockReturnValue({ iss: "https://oidc.vercel.com/team_123" });
  vi.stubEnv("VERCEL_OIDC_TOKEN", OWN_TOKEN);
  mockOwnSource({ owner_id: "team_123", project_id: "prj_123" });
  jwtVerifyMock.mockImplementation((token) =>
    token === OWN_TOKEN ? ownTokenResult() : sandboxTokenResult(),
  );
  mockSandboxToken(
    makeJwtVerifyResult({
      team_id: "team_123",
      project_id: "prj_123",
      sandbox_id: "sbx_123",
      sandbox_name: "sandbox-name",
    }),
  );
});

describe("defineSandboxProxy", () => {
  it("sanitizes and forwards valid proxied requests with sandbox metadata", async () => {
    const handler = vi.fn(async (request: Request, meta) => {
      expect(request.url).toBe("https://example.com/some/path?foo=bar");
      expect(request.method).toBe("POST");
      expect(request.headers.get("host")).toBe("example.com");
      expect(request.headers.get("x-client-header")).toBe("kept");
      expect(request.headers.get("vercel-forwarded-host")).toBeNull();
      expect(request.headers.get("vercel-forwarded-scheme")).toBeNull();
      expect(request.headers.get("vercel-forwarded-port")).toBeNull();
      expect(request.headers.get("vercel-forwarded-path")).toBeNull();
      expect(request.headers.get("vercel-sandbox-oidc-token")).toBeNull();
      expect(await request.text()).toBe("request body");
      expect(meta).toEqual({
        host: "proxy.vercel.app",
        teamId: "team_123",
        projectId: "prj_123",
        sandboxId: "sbx_123",
        sandboxName: "sandbox-name",
      });

      return new Response("ok");
    });
    const proxy = defineSandboxProxy(handler);

    const response = await proxy(
      new Request("https://proxy.vercel.app/proxy/some/path?foo=bar", {
        method: "POST",
        body: "request body",
        headers: {
          "x-client-header": "kept",
          "vercel-forwarded-host": "example.com",
          "vercel-forwarded-scheme": "https",
          "vercel-forwarded-port": "443",
          "vercel-forwarded-path": "/some/path?foo=bar",
          "vercel-sandbox-oidc-token": "token_123",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("sanitizes and forwards root proxied requests", async () => {
    const handler = vi.fn((request: Request) => {
      expect(request.url).toBe("https://example.com/");

      return new Response("ok");
    });
    const proxy = defineSandboxProxy(handler);

    const response = await proxy(
      makeProxyRequest({
        url: "https://proxy.vercel.app/proxy",
        headers: { "vercel-forwarded-path": "/" },
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("verifies OIDC tokens against the forward URL instead of the appended proxied path", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler);

    await proxy(makeProxyRequest());

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "token_123",
      expect.any(Function),
      expect.objectContaining({
        audience: "https://proxy.vercel.app/proxy",
      }),
    );
  });

  it("accepts origin-only forward URL audiences", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler);

    await proxy(
      makeProxyRequest({ url: "https://proxy.vercel.app/some/path" }),
    );

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "token_123",
      expect.any(Function),
      expect.objectContaining({
        audience: "https://proxy.vercel.app",
      }),
    );
  });

  it("normalizes trailing slashes before verifying forward URL audiences", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler);

    await proxy(
      makeProxyRequest({
        url: "https://proxy.vercel.app/proxy/some/path/",
        headers: { "vercel-forwarded-path": "/some/path/" },
      }),
    );

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "token_123",
      expect.any(Function),
      expect.objectContaining({
        audience: "https://proxy.vercel.app/proxy",
      }),
    );
  });

  it("accepts forwarded paths with a trailing slash when the proxy request URL omits it", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler);

    await proxy(
      makeProxyRequest({
        url: "https://proxy.vercel.app/api/proxy/docs",
        headers: { "vercel-forwarded-path": "/docs/" },
      }),
    );

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "token_123",
      expect.any(Function),
      expect.objectContaining({
        audience: "https://proxy.vercel.app/api/proxy",
      }),
    );
  });

  it("defaults sandboxName to sandboxId when the token has no sandbox_name claim", async () => {
    mockSandboxToken(
      makeJwtVerifyResult({
        team_id: "team_123",
        project_id: "prj_123",
        sandbox_id: "sbx_123",
      }),
    );

    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler);

    await proxy(makeProxyRequest());

    expect(handler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ sandboxName: "sbx_123" }),
    );
  });

  it("uses the default 403 response for missing proxy headers", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler);

    const response = await proxy(new Request("https://proxy.vercel.app/proxy"));

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
    expect(handler).not.toHaveBeenCalled();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("calls the invalid request handler with the original request when required headers are missing", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (request: Request, error: Error) =>
        new Response(
          JSON.stringify({
            error: error.message,
            forwardedHost: request.headers.get("vercel-forwarded-host"),
          }),
          { status: 401 },
        ),
    );
    const proxy = defineSandboxProxy(handler, {
      onInvalidRequest: invalidRequestHandler,
    });

    const response = await proxy(
      makeProxyRequest({
        headers: { "vercel-sandbox-oidc-token": null },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Missing required proxy headers",
      forwardedHost: "example.com",
    });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("calls the invalid request handler with stripped headers when the forwarded URL is invalid", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (request: Request, error: Error) =>
        new Response(
          JSON.stringify({
            error: error.message,
            forwardedHost: request.headers.get("vercel-forwarded-host"),
            oidcToken: request.headers.get("vercel-sandbox-oidc-token"),
          }),
          { status: 400 },
        ),
    );
    const proxy = defineSandboxProxy(handler, {
      onInvalidRequest: invalidRequestHandler,
    });

    const response = await proxy(
      makeProxyRequest({
        headers: { "vercel-forwarded-host": "exa mple.com" },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Invalid proxied request URL",
      forwardedHost: null,
      oidcToken: null,
    });
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("calls the invalid request handler with the sanitized request when OIDC verification fails", async () => {
    mockSandboxTokenError(new Error("bad token"));
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (request: Request, error: Error) =>
        new Response(
          JSON.stringify({
            error: error.message,
            url: request.url,
            forwardedHost: request.headers.get("vercel-forwarded-host"),
            host: request.headers.get("host"),
          }),
          { status: 401 },
        ),
    );
    const proxy = defineSandboxProxy(handler, {
      onInvalidRequest: invalidRequestHandler,
    });

    const response = await proxy(makeProxyRequest());

    await expect(response.json()).resolves.toEqual({
      error: "bad token",
      url: "https://example.com/some/path?foo=bar",
      forwardedHost: null,
      host: "example.com",
    });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("limits the number of cached JWKS issuers", async () => {
    mockSandboxTokenError(new Error("bad token"));
    const proxy = defineSandboxProxy(() => new Response("ok"));
    const sendRequestWithIssuer = async (issuerIndex: number) => {
      decodeJwtMock.mockReturnValue({
        iss: `https://oidc.vercel.com/cache-test-${issuerIndex}`,
      });
      await proxy(makeProxyRequest());
    };

    for (let issuerIndex = 0; issuerIndex < 100; issuerIndex++) {
      await sendRequestWithIssuer(issuerIndex);
    }

    await sendRequestWithIssuer(0);
    await sendRequestWithIssuer(100);
    await sendRequestWithIssuer(0);

    expect(createRemoteJWKSetMock).toHaveBeenCalledTimes(101);

    await sendRequestWithIssuer(1);

    expect(createRemoteJWKSetMock).toHaveBeenCalledTimes(102);
  });

  it("rejects tokens without a Vercel OIDC issuer before verifying the signature", async () => {
    decodeJwtMock.mockReturnValue({ iss: "https://example.com/team_123" });
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (_request: Request, error: Error) =>
        new Response(error.message, { status: 401 }),
    );
    const proxy = defineSandboxProxy(handler, {
      onInvalidRequest: invalidRequestHandler,
    });

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid OIDC issuer");
    expect(handler).not.toHaveBeenCalled();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it.each([
    "https://oidc.vercel.com/team_123#",
    "https://oidc.vercel.com/team_123?x=1",
    "https://oidc.vercel.com/team_123/extra",
    "https://oidc.vercel.com:8443/team_123",
    "https://user@oidc.vercel.com/team_123",
  ])("rejects tokens with a non-canonical issuer %s", async (issuer) => {
    decodeJwtMock.mockReturnValue({ iss: issuer });
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (_request: Request, error: Error) =>
        new Response(error.message, { status: 401 }),
    );
    const proxy = defineSandboxProxy(handler, {
      onInvalidRequest: invalidRequestHandler,
    });

    const response = await proxy(makeProxyRequest());

    expect(await response.text()).toBe("Invalid OIDC issuer");
    expect(handler).not.toHaveBeenCalled();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("accepts the root Vercel OIDC issuer", async () => {
    decodeJwtMock.mockReturnValue({ iss: "https://oidc.vercel.com" });
    const proxy = defineSandboxProxy(() => new Response("ok"));

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(200);
  });

  it("rejects tokens missing required sandbox claims", async () => {
    mockSandboxToken(
      makeJwtVerifyResult({
        team_id: "team_123",
        project_id: "prj_123",
      }),
    );
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (_request: Request, error: Error) =>
        new Response(error.message, { status: 401 }),
    );
    const proxy = defineSandboxProxy(handler, {
      onInvalidRequest: invalidRequestHandler,
    });

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Missing required claims in OIDC token");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["team", { owner_id: "team_other", project_id: "prj_123" }],
    ["project", { owner_id: "team_123", project_id: "prj_other" }],
  ])(
    "rejects sandboxes from a different %s than the proxy's own",
    async (_kind, ownClaims) => {
      mockOwnSource(ownClaims);
      const handler = vi.fn(() => new Response("ok"));
      const invalidRequestHandler = vi.fn(
        (_request: Request, error: Error) =>
          new Response(error.message, { status: 401 }),
      );
      const proxy = defineSandboxProxy(handler, {
        onInvalidRequest: invalidRequestHandler,
      });

      const response = await proxy(makeProxyRequest());

      expect(response.status).toBe(401);
      expect(await response.text()).toBe(
        "Sandbox is not allowed to use this proxy",
      );
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("returns 403 by default for sandboxes that are not allowed", async () => {
    mockOwnSource({ owner_id: "team_other", project_id: "prj_other" });
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler);

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the invalid request handler with the sanitized request when the sandbox is not allowed", async () => {
    mockOwnSource({ owner_id: "team_other", project_id: "prj_123" });
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (request: Request) =>
        new Response(
          JSON.stringify({
            url: request.url,
            host: request.headers.get("host"),
            oidcToken: request.headers.get("vercel-sandbox-oidc-token"),
          }),
          { status: 401 },
        ),
    );
    const proxy = defineSandboxProxy(handler, {
      onInvalidRequest: invalidRequestHandler,
    });

    const response = await proxy(makeProxyRequest());

    await expect(response.json()).resolves.toEqual({
      url: "https://example.com/some/path?foo=bar",
      host: "example.com",
      oidcToken: null,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("looks up the proxy's own team and project once", async () => {
    const proxy = defineSandboxProxy(() => new Response("ok"));

    await proxy(makeProxyRequest());
    await proxy(makeProxyRequest());

    expect(ownTokenVerifications()).toBe(1);
  });

  it("accepts sandboxes from other allowed teams and projects", async () => {
    mockOwnSource({ owner_id: "team_own", project_id: "prj_own" });
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler, {
      teamId: ["team_other", "team_123"],
      projectId: ["prj_123", "prj_other"],
    });

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("still accepts the proxy's own team and project when others are allowed", async () => {
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler, {
      teamId: "team_other",
      projectId: "prj_other",
    });

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("accepts readonly ID lists", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const teamIds = ["team_123"] as const;
    const projectIds: readonly string[] = ["prj_123"];
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler, {
      teamId: teamIds,
      projectId: projectIds,
    });

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(200);
  });

  it("uses only the allowed teams and projects when its own cannot be determined", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler, {
      teamId: "team_other",
      projectId: "prj_other",
    });

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the OIDC token is unavailable",
      () => vi.stubEnv("VERCEL_OIDC_TOKEN", ""),
    ],
    [
      "the OIDC token does not verify",
      () => mockOwnSourceError(new Error("bad signature")),
    ],
    [
      "the OIDC token has no project",
      () => mockOwnSource({ owner_id: "team_123" }),
    ],
    [
      "the OIDC token is for another project",
      () => {
        ownTokenResult = async () =>
          makeJwtVerifyResult({
            owner_id: "team_123",
            project_id: "prj_other",
          });
      },
    ],
    ["VERCEL_PROJECT_ID is not set", () => vi.stubEnv("VERCEL_PROJECT_ID", "")],
  ])(
    "rejects requests when %s and no teams or projects are allowed",
    async (_case, arrange) => {
      arrange();
      const handler = vi.fn(() => new Response("ok"));
      const invalidRequestHandler = vi.fn(
        (_request: Request, error: Error) =>
          new Response(error.message, { status: 500 }),
      );
      const proxy = defineSandboxProxy(handler, {
        onInvalidRequest: invalidRequestHandler,
      });

      const response = await proxy(makeProxyRequest());

      expect(response.status).toBe(500);
      expect(await response.text()).toMatch(
        /Could not determine this proxy's team and project/,
      );
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("verifies the proxy's own OIDC token before trusting its team and project", async () => {
    const proxy = defineSandboxProxy(() => new Response("ok"));

    await proxy(makeProxyRequest());

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      OWN_TOKEN,
      expect.any(Function),
      expect.objectContaining({ algorithms: ["RS256"] }),
    );
  });

  it("reads the proxy's own OIDC token from the Vercel request context first", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "env_token");
    const symbol = Symbol.for("@vercel/request-context");
    const global = globalThis as Record<symbol, unknown>;
    global[symbol] = {
      get: () => ({ headers: { "x-vercel-oidc-token": OWN_TOKEN } }),
    };
    try {
      const proxy = defineSandboxProxy(() => new Response("ok"));

      expect((await proxy(makeProxyRequest())).status).toBe(200);
      expect(ownTokenVerifications()).toBe(1);
    } finally {
      delete global[symbol];
    }
  });

  it("shares one lookup of its own team and project between concurrent requests", async () => {
    const proxy = defineSandboxProxy(() => new Response("ok"));

    const responses = await Promise.all([
      proxy(makeProxyRequest()),
      proxy(makeProxyRequest()),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(ownTokenVerifications()).toBe(1);
  });

  it("retries a failed lookup of its own team and project after a delay", async () => {
    vi.useFakeTimers();
    try {
      mockOwnSourceError(new Error("jwks unavailable"));
      const proxy = defineSandboxProxy(() => new Response("ok"));

      expect((await proxy(makeProxyRequest())).status).toBe(403);
      expect((await proxy(makeProxyRequest())).status).toBe(403);
      expect(ownTokenVerifications()).toBe(1);

      mockOwnSource({ owner_id: "team_123", project_id: "prj_123" });
      vi.advanceTimersByTime(60_000);

      expect((await proxy(makeProxyRequest())).status).toBe(200);
      expect(ownTokenVerifications()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts sandboxes from any team when dangerouslyAllowAll is set", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    mockSandboxToken(
      makeJwtVerifyResult({
        team_id: "team_other",
        project_id: "prj_other",
        sandbox_id: "sbx_123",
      }),
    );
    const handler = vi.fn(() => new Response("ok"));
    const proxy = defineSandboxProxy(handler, { dangerouslyAllowAll: true });

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ownTokenVerifications()).toBe(0);
  });

  it("still rejects invalid tokens when dangerouslyAllowAll is set", async () => {
    mockSandboxTokenError(new Error("bad token"));
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (_request: Request, error: Error) =>
        new Response(error.message, { status: 401 }),
    );
    const proxy = defineSandboxProxy(handler, {
      dangerouslyAllowAll: true,
      onInvalidRequest: invalidRequestHandler,
    });

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("bad token");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects invalid options at the type level", () => {
    const handler = () => new Response("ok");

    expect(() =>
      // @ts-expect-error — the invalid request handler moved to `onInvalidRequest`
      defineSandboxProxy(handler, () => new Response("no")),
    ).toThrow();
    expect(() =>
      defineSandboxProxy(handler, {
        dangerouslyAllowAll: true,
        // @ts-expect-error — `dangerouslyAllowAll` cannot be combined with an allowlist
        teamId: "team_123",
      }),
    ).toThrow();
  });

  it.each([
    ["null options", null],
    ["only a team", { teamId: "team_123" }],
    ["only a project", { projectId: "prj_123" }],
    ["an empty team", { teamId: "", projectId: "prj_123" }],
    ["an empty team list", { teamId: [], projectId: "prj_123" }],
    [
      "an empty entry in a team list",
      { teamId: ["team_123", ""], projectId: "prj_123" },
    ],
    [
      "a non-string entry in a project list",
      { teamId: "team_123", projectId: ["prj_123", 42] },
    ],
    ["a sparse project list", { teamId: "team_123", projectId: [, "prj_123"] }],
    ["dangerouslyAllowAll set to false", { dangerouslyAllowAll: false }],
    [
      "dangerouslyAllowAll with an allowlist",
      { dangerouslyAllowAll: true, teamId: "team_123", projectId: "prj_123" },
    ],
    [
      "an invalid request handler as the second argument",
      () => new Response("no"),
    ],
  ])("throws at definition time with %s", (_case, options) => {
    expect(() =>
      defineSandboxProxy(
        () => new Response("ok"),
        options as unknown as Parameters<typeof defineSandboxProxy>[1],
      ),
    ).toThrow(/defineSandboxProxy/);
  });
});

function makeProxyRequest({
  url = "https://proxy.vercel.app/proxy/some/path?foo=bar",
  headers: headerOverrides = {},
}: {
  url?: string;
  headers?: Record<string, string | null>;
} = {}): Request {
  const headers = new Headers({
    "vercel-forwarded-host": "example.com",
    "vercel-forwarded-scheme": "https",
    "vercel-forwarded-port": "443",
    "vercel-forwarded-path": "/some/path?foo=bar",
    "vercel-sandbox-oidc-token": "token_123",
  });

  for (const [key, value] of Object.entries(headerOverrides)) {
    if (value === null) {
      headers.delete(key);
    } else {
      headers.set(key, value);
    }
  }

  return new Request(url, { headers });
}

function makeJwtVerifyResult(
  payload: Record<string, unknown>,
): Awaited<ReturnType<typeof jwtVerify>> {
  return {
    payload,
    protectedHeader: { alg: "RS256" },
    key: {},
  } as Awaited<ReturnType<typeof jwtVerify>>;
}
