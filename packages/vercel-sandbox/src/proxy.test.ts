import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.resetAllMocks();

  createRemoteJWKSetMock.mockReturnValue(
    vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>,
  );
  decodeJwtMock.mockReturnValue({ iss: "https://oidc.vercel.com/team_123" });
  jwtVerifyMock.mockResolvedValue(
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

  it("defaults sandboxName to sandboxId when the token has no sandbox_name claim", async () => {
    jwtVerifyMock.mockResolvedValue(
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
    const proxy = defineSandboxProxy(handler, invalidRequestHandler);

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
    const proxy = defineSandboxProxy(handler, invalidRequestHandler);

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
    jwtVerifyMock.mockRejectedValue(new Error("bad token"));
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
    const proxy = defineSandboxProxy(handler, invalidRequestHandler);

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

  it("rejects tokens without a Vercel OIDC issuer before verifying the signature", async () => {
    decodeJwtMock.mockReturnValue({ iss: "https://example.com/team_123" });
    const handler = vi.fn(() => new Response("ok"));
    const invalidRequestHandler = vi.fn(
      (_request: Request, error: Error) =>
        new Response(error.message, { status: 401 }),
    );
    const proxy = defineSandboxProxy(handler, invalidRequestHandler);

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid OIDC issuer");
    expect(handler).not.toHaveBeenCalled();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("rejects tokens missing required sandbox claims", async () => {
    jwtVerifyMock.mockResolvedValue(
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
    const proxy = defineSandboxProxy(handler, invalidRequestHandler);

    const response = await proxy(makeProxyRequest());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Missing required claims in OIDC token");
    expect(handler).not.toHaveBeenCalled();
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
