import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  password: vi.fn(),
  entry: vi.fn(),
}));
vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: class {
    constructor(...args: unknown[]) {
      mocks.entry(...args);
    }
    getPassword = mocks.get;
    setPassword = mocks.set;
  },
}));
vi.mock("@inquirer/prompts", () => ({
  select: mocks.select,
  confirm: mocks.confirm,
  password: mocks.password,
}));
import {
  credentialAccount,
  resolveGatewayKey,
} from "../../src/util/agent-gateway/credentials";
import { gatewayKeyFingerprint } from "../../src/util/agent-gateway/policy";
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
const scope = {
  token: "host-vercel-token",
  team: "team_test",
  project: "project",
};
function fetchFixture() {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v2/user") return Response.json({ user: { id: "user" } });
    if (path === "/v1/api-keys" && init?.method === "POST")
      return Response.json({
        apiKeyString: "new-secret",
        apiKey: { id: "id", teamId: "team_test" },
      });
    if (path === "/v1/api-keys/id")
      return Response.json({
        apiKey: {
          teamId: "team_test",
          purpose: "ai-gateway",
          expiresAt: null,
          leakedAt: null,
        },
      });
    return Response.json({ balance: "1" });
  });
}
describe("Gateway credential reuse", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubGlobal("fetch", fetchFixture());
    mocks.get.mockResolvedValue(undefined);
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const [stream, desc] of [
      [process.stdin, stdinTTY],
      [process.stderr, stderrTTY],
    ] as const) {
      if (desc) Object.defineProperty(stream, "isTTY", desc);
      else delete (stream as any).isTTY;
    }
  });
  test("host key stays external and bypasses storage and management API", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "host-secret");
    expect(await resolveGatewayKey(scope)).toBe("host-secret");
    expect(mocks.entry).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });
  test("optional lookup does not prompt, mint, or save a key when none exists", async () => {
    expect(await resolveGatewayKey(scope, { optional: true })).toBeUndefined();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => options?.method !== "POST"),
    ).toBe(true);
  });
  test("cached user/team key is reused without provisioning", async () => {
    mocks.get.mockResolvedValue(
      JSON.stringify({
        user: "user",
        team: "team_test",
        key: "saved-secret",
        id: "id",
      }),
    );
    expect(await resolveGatewayKey(scope)).toBe("saved-secret");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.entry).toHaveBeenCalledWith(
      "Vercel Sandbox AI Gateway",
      credentialAccount("user", "team_test"),
      { linux: { store: "secret-service" } },
    );
    expect(credentialAccount("other-user", "team_test")).not.toBe(
      credentialAccount("user", "team_test"),
    );
    expect(credentialAccount("user", "other-team")).not.toBe(
      credentialAccount("user", "team_test"),
    );
  });
  test("replacement retains the original key for existing sandboxes", async () => {
    mocks.get.mockResolvedValue(
      JSON.stringify({
        user: "user",
        team: "team_test",
        key: "original",
        id: "id",
      }),
    );
    mocks.select.mockResolvedValue("create");
    mocks.confirm.mockResolvedValue(true);
    mocks.set.mockImplementation(async (value: string) => {
      mocks.get.mockResolvedValue(value);
    });
    expect(await resolveGatewayKey(scope, { setup: true })).toBe("new-secret");
    expect(await resolveGatewayKey(scope)).toBe("new-secret");
    expect(
      await resolveGatewayKey(scope, {
        fingerprint: gatewayKeyFingerprint("original"),
      }),
    ).toBe("original");
  });
  test("a different host key cannot silently replace a sandbox's original key", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "different-secret");
    await expect(
      resolveGatewayKey(scope, {
        fingerprint: gatewayKeyFingerprint("original"),
      }),
    ).rejects.toThrow("original Gateway key");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.entry).not.toHaveBeenCalled();
  });
  test("provisions once, saves securely, then reuses across invocations", async () => {
    mocks.select.mockResolvedValue("create");
    mocks.confirm.mockResolvedValue(true);
    mocks.set.mockImplementation(async (value: string) => {
      mocks.get.mockResolvedValue(value);
    });
    expect(await resolveGatewayKey(scope)).toBe("new-secret");
    expect(await resolveGatewayKey(scope)).toBe("new-secret");
    expect(mocks.set).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            init?.method === "POST" &&
            new URL(String(url)).pathname === "/v1/api-keys",
        ),
    ).toHaveLength(1);
  });
  test("cancellation never provisions or stores a key", async () => {
    mocks.select.mockResolvedValue("create");
    mocks.confirm.mockResolvedValue(false);
    await expect(resolveGatewayKey(scope)).rejects.toThrow("cancelled");
    expect(mocks.set).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            init?.method === "POST" &&
            new URL(String(url)).pathname === "/v1/api-keys",
        ),
    ).toHaveLength(0);
  });
  test("concurrent setup creates one key for the same user and team", async () => {
    mocks.select.mockResolvedValue("create");
    mocks.confirm.mockResolvedValue(true);
    mocks.set.mockImplementation(async (value: string) => {
      mocks.get.mockResolvedValue(value);
    });
    expect(
      await Promise.all([resolveGatewayKey(scope), resolveGatewayKey(scope)]),
    ).toEqual(["new-secret", "new-secret"]);
    expect(mocks.set).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            init?.method === "POST" &&
            new URL(String(url)).pathname === "/v1/api-keys",
        ),
    ).toHaveLength(1);
  });
  test("noninteractive setup fails without provisioning or plaintext fallback", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    await expect(resolveGatewayKey(scope)).rejects.toThrow(
      "Gateway setup needs a terminal",
    );
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, init]) =>
            init?.method === "POST" &&
            new URL(String(url)).pathname === "/v1/api-keys",
        ),
    ).toHaveLength(0);
  });
  test("a team slug shares the canonical team's stored key", async () => {
    const fixture = fetchFixture();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === "/v2/teams/my-team")
        return Response.json({ id: "team_test", slug: "my-team" });
      return fixture(String(url), init);
    });
    mocks.select.mockResolvedValue("create");
    mocks.confirm.mockResolvedValue(true);
    mocks.set.mockImplementation(async (value: string) => {
      mocks.get.mockResolvedValue(value);
    });
    expect(await resolveGatewayKey({ ...scope, team: "my-team" })).toBe(
      "new-secret",
    );
    expect(await resolveGatewayKey(scope)).toBe("new-secret");
    expect(mocks.set).toHaveBeenCalledOnce();
    const creation = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          init?.method === "POST" &&
          new URL(String(url)).pathname === "/v1/api-keys",
      );
    expect(new URL(String(creation?.[0])).searchParams.get("teamId")).toBe(
      "team_test",
    );
    expect(mocks.entry.mock.calls[0][1]).toBe(mocks.entry.mock.calls[1][1]);
  });
  test("known expiry covers the requested duration and margin", async () => {
    mocks.get.mockResolvedValue(
      JSON.stringify({
        user: "user",
        team: "team_test",
        key: "saved-secret",
        id: "id",
      }),
    );
    const fixture = fetchFixture();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === "/v1/api-keys/id")
        return Response.json({
          apiKey: {
            teamId: "team_test",
            purpose: "ai-gateway",
            expiresAt: Date.now() + 2 * 60 * 60 * 1000,
            leakedAt: null,
          },
        });
      return fixture(String(url), init);
    });
    expect(await resolveGatewayKey(scope, { durationMs: 5 * 60 * 1000 })).toBe(
      "saved-secret",
    );
    await expect(
      resolveGatewayKey(scope, { durationMs: 2 * 60 * 60 * 1000 }),
    ).rejects.toThrow("session duration");
    await expect(resolveGatewayKey(scope)).rejects.toThrow("session duration");
  });
  test("corrupt stored JSON cannot appear in the error", async () => {
    mocks.get.mockResolvedValue('{"key":"secret-this-must-not-appear"');
    await expect(resolveGatewayKey(scope)).rejects.toThrow(
      /^Saved Gateway credentials are invalid/,
    );
  });
  test("optional lookup uses managed Gateway when the OS store cannot be read", async () => {
    mocks.get.mockRejectedValue(new Error("private-native-error"));
    expect(await resolveGatewayKey(scope, { optional: true })).toBeUndefined();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => options?.method !== "POST"),
    ).toBe(true);
    await expect(
      resolveGatewayKey(scope, {
        fingerprint: gatewayKeyFingerprint("original"),
      }),
    ).rejects.toThrow(/^The OS credential store is locked/);
  });
  test("does not fall back to plaintext when the store fails", async () => {
    mocks.get.mockRejectedValue(new Error("private-native-error"));
    await expect(resolveGatewayKey(scope)).rejects.toThrow(
      /^The OS credential store is locked/,
    );
    expect(mocks.select).not.toHaveBeenCalled();
  });
  test("rejects a revoked host key without printing the server body", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "host-secret");
    vi.mocked(fetch).mockResolvedValue(
      new Response("echoed-secret", { status: 401 }),
    );
    await expect(resolveGatewayKey(scope)).rejects.toThrow(
      /^Gateway rejected the key \(HTTP 401\)/,
    );
  });
  test("a revoked bound key recommends a new sandbox rather than replacing its key", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "original");
    vi.mocked(fetch).mockResolvedValue(
      new Response("private-server-body", { status: 401 }),
    );
    await expect(
      resolveGatewayKey(scope, {
        fingerprint: gatewayKeyFingerprint("original"),
      }),
    ).rejects.toThrow(/create a new sandbox with --ai/);
  });
});
