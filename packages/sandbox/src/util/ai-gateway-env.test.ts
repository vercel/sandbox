import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAiGatewayEnv,
  getProjectOidcToken,
  resetProjectOidcTokenCache,
  AI_GATEWAY_BASE_URL,
} from "./ai-gateway-env";

const fetchMock = vi.fn<typeof globalThis.fetch>();

/** A structurally valid JWT (three base64url segments) for OIDC detection. */
const OIDC_TOKEN = [
  Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
    "base64url",
  ),
  Buffer.from(
    JSON.stringify({ sub: "owner:team:project:proj:environment:development" }),
  ).toString("base64url"),
  "signature",
].join(".");

const SCOPE = { token: "pat_123", team: "team_1", project: "prj_1" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  resetProjectOidcTokenCache();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("getProjectOidcToken", () => {
  it("reuses the CLI token when it is already an OIDC JWT", async () => {
    const token = await getProjectOidcToken({ ...SCOPE, token: OIDC_TOKEN });
    expect(token).toBe(OIDC_TOKEN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints a token through the project env endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ env: { VERCEL_OIDC_TOKEN: OIDC_TOKEN } }),
    );

    const token = await getProjectOidcToken(SCOPE);

    expect(token).toBe(OIDC_TOKEN);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://vercel.com/api/v3/env/pull/prj_1?teamId=team_1",
      { headers: { Authorization: "Bearer pat_123" } },
    );
  });

  it("memoizes mints for the same team/project", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ env: { VERCEL_OIDC_TOKEN: OIDC_TOKEN } }),
    );

    await getProjectOidcToken(SCOPE);
    await getProjectOidcToken(SCOPE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-mints after a failure", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 403 }))
      .mockResolvedValueOnce(
        jsonResponse({ env: { VERCEL_OIDC_TOKEN: OIDC_TOKEN } }),
      );

    await expect(getProjectOidcToken(SCOPE)).rejects.toThrow(
      /Could not obtain AI Gateway credentials \(403\)/,
    );
    await expect(getProjectOidcToken(SCOPE)).resolves.toBe(OIDC_TOKEN);
  });

  it("throws a helpful error when the project has no OIDC token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ env: {} }));

    await expect(getProjectOidcToken(SCOPE)).rejects.toThrow(
      /no OIDC token available/,
    );
  });

  it("surfaces the API error code when the request fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "forbidden", message: "Not authorized" } },
        403,
      ),
    );

    await expect(getProjectOidcToken(SCOPE)).rejects.toThrow(
      /FORBIDDEN: Not authorized/,
    );
  });
});

describe("getAiGatewayEnv", () => {
  it("returns the gateway variables sharing one token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ env: { VERCEL_OIDC_TOKEN: OIDC_TOKEN } }),
    );

    await expect(getAiGatewayEnv(SCOPE)).resolves.toEqual({
      AI_GATEWAY_API_KEY: OIDC_TOKEN,
      ANTHROPIC_BASE_URL: AI_GATEWAY_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: OIDC_TOKEN,
    });
  });
});
