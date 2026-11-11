import { testConfig } from "../../test/config.js";
import { APIError } from "./api-error.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getVercelOidcToken } = vi.hoisted(() => ({
  getVercelOidcToken: vi.fn<(...args: unknown[]) => Promise<string>>(),
}));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken }));

import { AuthenticatedClient } from "./authenticated-client.js";
import type { RequestParams } from "./base-client.js";

class TestClient extends AuthenticatedClient {
  send(path = "/v2/sandboxes", params?: RequestParams) {
    return this.request(path, params);
  }
}

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("APIClient OIDC token refresh", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    getVercelOidcToken.mockReset();
    fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const authHeader = (call: number) =>
    new Headers(fetchMock.mock.calls[call][1]?.headers).get("authorization");

  const client = (token: string) =>
    new TestClient({
      teamId: "team_fallback",
      token,
      fetch: fetchMock,
      config: testConfig,
      apiError: APIError,
    });

  it("does not consult @vercel/oidc while the token is far from expiring", async () => {
    const token = jwt({ owner_id: "team_1", exp: nowSeconds() + 3600 });
    const c = client(token);

    await c.send();
    await c.send();
    await c.send();

    expect(getVercelOidcToken).not.toHaveBeenCalled();
    expect(authHeader(2)).toBe(`Bearer ${token}`);
  });

  it("refreshes once the token is within the refresh buffer, then reuses the new token", async () => {
    const stale = jwt({ owner_id: "team_1", exp: nowSeconds() + 60 });
    const fresh = jwt({ owner_id: "team_2", exp: nowSeconds() + 3600 });
    getVercelOidcToken.mockResolvedValue(fresh);
    const c = client(stale);

    await c.send();
    await c.send();

    expect(getVercelOidcToken).toHaveBeenCalledTimes(1);
    expect(getVercelOidcToken).toHaveBeenCalledWith(
      expect.objectContaining({
        expirationBufferMs: 5 * 60 * 1000,
        team: "team_1",
      }),
    );
    expect(authHeader(0)).toBe(`Bearer ${fresh}`);
    expect(authHeader(1)).toBe(`Bearer ${fresh}`);
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.searchParams.get("teamId")).toBe("team_2");
  });

  it("refreshes when a cached token approaches expiry over time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const first = jwt({ owner_id: "team_1", exp: nowSeconds() + 3600 });
    const second = jwt({ owner_id: "team_1", exp: nowSeconds() + 7200 });
    getVercelOidcToken.mockResolvedValue(second);
    const c = client(first);

    await c.send();
    expect(getVercelOidcToken).not.toHaveBeenCalled();

    // 56 minutes later the token has 4 minutes left: inside the 5 minute buffer.
    vi.setSystemTime(new Date("2026-01-01T00:56:00Z"));
    await c.send();
    expect(getVercelOidcToken).toHaveBeenCalledTimes(1);
    expect(authHeader(1)).toBe(`Bearer ${second}`);
  });

  it("shares one refresh between concurrent requests", async () => {
    const stale = jwt({ owner_id: "team_1", exp: nowSeconds() + 60 });
    const fresh = jwt({ owner_id: "team_1", exp: nowSeconds() + 3600 });
    let resolveRefresh!: (token: string) => void;
    getVercelOidcToken.mockReturnValue(
      new Promise((resolve) => (resolveRefresh = resolve)),
    );
    const c = client(stale);

    const requests = Promise.all([c.send(), c.send(), c.send()]);
    resolveRefresh(fresh);
    await requests;

    expect(getVercelOidcToken).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      expect(authHeader(i)).toBe(`Bearer ${fresh}`);
    }
  });

  it("keeps the current token and retries the refresh next time if it fails", async () => {
    const stale = jwt({ owner_id: "team_1", exp: nowSeconds() + 60 });
    getVercelOidcToken.mockRejectedValue(new Error("no oidc context"));
    const c = client(stale);

    await c.send();
    await c.send();

    expect(getVercelOidcToken).toHaveBeenCalledTimes(2);
    expect(authHeader(1)).toBe(`Bearer ${stale}`);
  });

  it("checks on every request when the token has no exp claim", async () => {
    const token = jwt({ owner_id: "team_1" });
    getVercelOidcToken.mockResolvedValue(token);
    const c = client(token);

    await c.send();
    await c.send();

    expect(getVercelOidcToken).toHaveBeenCalledTimes(2);
  });

  it("never consults @vercel/oidc for non-JWT access tokens", async () => {
    const c = client("vercel_personal_access_token");

    await c.send();
    await c.send();

    expect(getVercelOidcToken).not.toHaveBeenCalled();
    expect(authHeader(0)).toBe("Bearer vercel_personal_access_token");
  });
});
