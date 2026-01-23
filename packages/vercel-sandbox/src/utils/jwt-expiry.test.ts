import { assert, beforeEach, describe, expect, test, vi } from "vitest";
import { JwtExpiry } from "./jwt-expiry";
import type { getVercelOidcToken } from "@vercel/oidc";

const { getVercelOidcTokenMock } = vi.hoisted(() => {
  return {
    getVercelOidcTokenMock: vi.fn<typeof getVercelOidcToken>(),
  };
});
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: getVercelOidcTokenMock,
}));
beforeEach(() => {
  getVercelOidcTokenMock.mockReset();
});

describe("JwtExpiry", () => {
  test("refreshes a token", async () => {
    const token = createMockJWT({
      owner_id: "team1",
      project_id: "proj1",
    });
    getVercelOidcTokenMock.mockImplementationOnce(async () => "hello world");
    const expiry = await JwtExpiry.fromToken(token)?.refresh();
    expect(expiry).toBeInstanceOf(JwtExpiry);
    expect(expiry?.token).toEqual("hello world");
  });

  test("isValid returns true for tokens without expiry", () => {
    // Mock token without exp field (like OIDC tokens without exp)
    const tokenWithoutExp = createMockJWT({
      owner_id: "team1",
      project_id: "proj1",
    });
    const expiry = JwtExpiry.fromToken(tokenWithoutExp);
    assert(expiry, "Expiry should not be null for valid JWT");
    expect(expiry.isValid()).toBe(false); // No exp field means malformed JWT
  });

  test("isValid returns true for unexpired tokens", () => {
    const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const tokenValid = createMockJWT({
      owner_id: "team1",
      project_id: "proj1",
      exp: futureTime,
    });
    const expiry = JwtExpiry.fromToken(tokenValid);
    assert(expiry, "Expiry should not be null for valid JWT");
    expect(expiry.isValid()).toBe(true);
  });

  test("isValid returns false for expired tokens", () => {
    const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const tokenExpired = createMockJWT({
      owner_id: "team1",
      project_id: "proj1",
      exp: pastTime,
    });
    const expiry = JwtExpiry.fromToken(tokenExpired);
    assert(expiry, "Expiry should not be null for valid JWT");
    expect(expiry.isValid()).toBe(false);
  });

  test("isValid returns false for tokens expiring within buffer time", () => {
    const soonTime = Math.floor(Date.now() / 1000) + 120; // 2 minutes from now
    const tokenExpiringSoon = createMockJWT({
      owner_id: "team1",
      project_id: "proj1",
      exp: soonTime,
    });
    const expiry = JwtExpiry.fromToken(tokenExpiringSoon);
    assert(expiry, "Expiry should not be null for valid JWT");
    expect(expiry.isValid(5)).toBe(false); // 5 minute buffer
  });

  test("isValid returns false for malformed JWT tokens", () => {
    const expiry = JwtExpiry.fromToken("header.invalid-payload.signature");
    assert(expiry, "Expiry should not be null for valid JWT");
    expect(expiry.isValid()).toBe(false);
  });

  test("getExpiryDate returns correct expiry date", () => {
    const expTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const token = createMockJWT({
      owner_id: "team1",
      project_id: "proj1",
      exp: expTime,
    });
    const expiry = JwtExpiry.fromToken(token);
    assert(expiry, "Expiry should not be null for valid JWT");
    expect(expiry.getExpiryDate()).toEqual(new Date(expTime * 1000));
  });

  test("getExpiryDate returns null for tokens without expiry", () => {
    const token = createMockJWT({ owner_id: "team1", project_id: "proj1" });
    const expiry = JwtExpiry.fromToken(token);
    assert(expiry, "Expiry should not be null for valid JWT");
    expect(expiry.getExpiryDate()).toBeNull();
  });

  test("getExpiryDate returns null for malformed tokens", () => {
    const token = "hello.world.hey";
    const expiry = JwtExpiry.fromToken(token);
    assert(expiry, "Expiry should not be null for valid JWT");
    expect(expiry.getExpiryDate()).toBeNull();
  });

  test("returns null for non-JWT style tokens", () => {
    expect(JwtExpiry.fromToken("personal-access-token")).toBeNull();
  });
});

// Helper function to create mock JWT tokens for testing
function createMockJWT(payload: any): string {
  const header = { typ: "JWT", alg: "HS256" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = "mock-signature";

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
