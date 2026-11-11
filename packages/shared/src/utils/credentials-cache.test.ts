import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedGenerateCredentials } from "./dev-credentials.js";
import { testConfig } from "../../test/config.js";

const sandboxCredentials = (opts: { teamId?: string; projectId?: string }) =>
  cachedGenerateCredentials(opts, { ...testConfig, name: "vercel/sandbox" });
const driveCredentials = (opts: { teamId?: string; projectId?: string }) =>
  cachedGenerateCredentials(opts, testConfig);

const auth = vi.hoisted(() => {
  const getAuth = vi.fn();
  const deviceAuthorizationRequest = vi.fn(async () => ({
    verification_uri: "https://example.com/device",
    verification_uri_complete: "https://example.com/device?code=test",
    user_code: "test",
  }));
  return {
    getAuth,
    deviceAuthorizationRequest,
    OAuth: vi.fn(async () => ({ deviceAuthorizationRequest })),
    pollForToken: vi.fn(async function* () {
      getAuth.mockReturnValue({ token: "test-token" });
      yield { _tag: "Response" };
    }),
    inferScope: vi.fn(async () => ({
      teamId: "team_test",
      projectId: "proj_test",
      created: false,
    })),
    updateAuthConfig: vi.fn(),
  };
});

vi.mock("../auth/index.js", () => auth);

beforeEach(() => {
  vi.clearAllMocks();
  auth.getAuth.mockReturnValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  Reflect.deleteProperty(
    globalThis,
    Symbol.for("@vercel/sandbox/credentials-cache"),
  );
  vi.restoreAllMocks();
});

describe("Drive credential compatibility", () => {
  it.each([
    { first: sandboxCredentials, second: driveCredentials, name: "Sandbox" },
    { first: driveCredentials, second: sandboxCredentials, name: "Drives" },
  ])("shares sign-in when $name starts first", async ({ first, second }) => {
    const credentials = await Promise.all([first({}), second({})]);

    expect(auth.deviceAuthorizationRequest).toHaveBeenCalledTimes(1);
    expect(auth.inferScope).toHaveBeenCalledTimes(1);
    expect(credentials[0]).toEqual({
      token: "test-token",
      teamId: "team_test",
      projectId: "proj_test",
    });
    expect(credentials[1]).toBe(credentials[0]);
  });

  it("allows either package to retry after a failed sign-in", async () => {
    auth.deviceAuthorizationRequest.mockRejectedValueOnce(
      new Error("sign-in failed"),
    );

    const results = await Promise.allSettled([
      sandboxCredentials({}),
      driveCredentials({}),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    await expect(driveCredentials({})).resolves.toMatchObject({
      token: "test-token",
    });
    expect(auth.deviceAuthorizationRequest).toHaveBeenCalledTimes(2);
  });
});
