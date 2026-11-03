import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { withAuthHeaders, type AuthHeadersProvider } from "./auth-headers.js";
import { APIClient } from "./api-client.js";
import { fetchApi } from "../auth/api.js";

/** A provider that signs a new, numbered "proof" for every request. */
function dpopProvider() {
  let proofs = 0;
  const provider = vi.fn((method: string, url: string) => ({
    authorization: "DPoP vca_token",
    dpop: `proof-${++proofs} ${method} ${url}`,
  }));
  return Object.assign(provider, {
    onResponse: vi.fn(),
  }) satisfies AuthHeadersProvider;
}

function nonceChallenge(nonce: string) {
  return new Response("{}", {
    status: 401,
    headers: {
      "www-authenticate": 'DPoP error="use_dpop_nonce"',
      "dpop-nonce": nonce,
    },
  });
}

function headersOf(call: unknown[]) {
  return new Headers((call[1] as RequestInit).headers);
}

describe("withAuthHeaders", () => {
  it("sets the provider's headers for the request's method and URL", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    const getAuthHeaders = dpopProvider();

    const response = await withAuthHeaders(fetch, getAuthHeaders)(
      "https://vercel.com/api/v1/sandboxes?teamId=team_1",
      { method: "POST", headers: { "x-test": "1" } },
    );

    expect(response.status).toBe(200);
    const headers = headersOf(fetch.mock.calls[0]);
    expect(headers.get("authorization")).toBe("DPoP vca_token");
    expect(headers.get("dpop")).toBe(
      "proof-1 POST https://vercel.com/api/v1/sandboxes?teamId=team_1",
    );
    expect(headers.get("x-test")).toBe("1");
    expect(getAuthHeaders.onResponse).toHaveBeenCalledWith(
      "https://vercel.com/api/v1/sandboxes?teamId=team_1",
      response.headers,
    );
  });

  it("sends a request once more when the server asks for a DPoP nonce", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(nonceChallenge("n1"))
      .mockResolvedValueOnce(new Response("{}"));
    const getAuthHeaders = dpopProvider();

    const response = await withAuthHeaders(fetch, getAuthHeaders)(
      "https://vercel.com/api/v2/user",
      { method: "GET" },
    );

    expect(response.status).toBe(200);
    expect(fetch.mock.calls.map((call) => headersOf(call).get("dpop"))).toEqual(
      [
        "proof-1 GET https://vercel.com/api/v2/user",
        "proof-2 GET https://vercel.com/api/v2/user",
      ],
    );
    expect(getAuthHeaders.onResponse).toHaveBeenCalledTimes(2);
    expect(getAuthHeaders.onResponse.mock.calls[0][1].get("dpop-nonce")).toBe(
      "n1",
    );
  });

  it("sends it once more at most", async () => {
    const fetch = vi.fn(async () => nonceChallenge("n1"));

    const response = await withAuthHeaders(
      fetch,
      dpopProvider(),
    )("https://vercel.com/api/v2/user");

    expect(response.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("doesn't send a stream body again", async () => {
    const fetch = vi.fn(async () => nonceChallenge("n1"));

    await withAuthHeaders(fetch, dpopProvider())(
      "https://vercel.com/api/v1/files",
      { method: "POST", body: Readable.from(["data"]) as never },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("APIClient with getAuthHeaders", () => {
  it("sends the provider's headers instead of Bearer, new on every retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValue(new Response("{}", { status: 404 }));
    const getAuthHeaders = dpopProvider();
    const client = new APIClient({
      teamId: "team_1",
      token: "",
      fetch,
      getAuthHeaders,
    });

    await client.getSession({ sessionId: "sbx_1" }).catch(() => undefined);

    expect(fetch).toHaveBeenCalledTimes(2);
    const proofs = fetch.mock.calls.map((call) => headersOf(call).get("dpop"));
    expect(proofs[0]).toMatch(/^proof-1 GET https:\/\/vercel\.com\/api\//);
    expect(proofs[1]).toMatch(/^proof-2 GET /);
    for (const call of fetch.mock.calls) {
      expect(headersOf(call).get("authorization")).toBe("DPoP vca_token");
    }
  });

  it("doesn't treat a JWT-shaped token as an OIDC token to refresh", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    const payload = Buffer.from(
      JSON.stringify({ owner_id: "team_from_token" }),
    ).toString("base64url");
    const client = new APIClient({
      teamId: "team_1",
      token: `header.${payload}.signature`,
      fetch,
      getAuthHeaders: dpopProvider(),
    });

    await client.getSession({ sessionId: "sbx_1" }).catch(() => undefined);

    expect(
      new URL(fetch.mock.calls[0][0] as string).searchParams.get("teamId"),
    ).toBe("team_1");
  });

  it("still sends Bearer without one", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    const client = new APIClient({ teamId: "team_1", token: "1234", fetch });

    await client.getSession({ sessionId: "sbx_1" }).catch(() => undefined);

    expect(headersOf(fetch.mock.calls[0]).get("authorization")).toBe(
      "Bearer 1234",
    );
  });
});

describe("fetchApi with getAuthHeaders", () => {
  it("sends the provider's headers instead of Bearer", async () => {
    const fetch = vi.fn(async () => new Response('{"user":{}}'));
    vi.stubGlobal("fetch", fetch);
    try {
      await fetchApi({
        token: "",
        getAuthHeaders: dpopProvider(),
        endpoint: "/v2/user",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const headers = headersOf(fetch.mock.calls[0]);
    expect(headers.get("authorization")).toBe("DPoP vca_token");
    expect(headers.get("dpop")).toBe(
      "proof-1 GET https://vercel.com/api/v2/user",
    );
    expect(headers.get("content-type")).toBe("application/json");
  });
});
