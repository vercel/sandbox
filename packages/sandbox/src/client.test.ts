import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configRoot = mkdtempSync(join(tmpdir(), "sandbox-client-test-"));

vi.mock("xdg-app-paths", () => ({
  default: (name: string) => ({
    config: () => join(configRoot, name),
    cache: () => join(configRoot, name, "cache"),
  }),
}));

import { sandboxClient, setGetAuthHeaders } from "./client";
import { writeTelemetryConfig } from "./telemetry";

describe("fetchWithUserAgent", () => {
  const fetchMock = vi.fn(
    async (..._args: Parameters<typeof globalThis.fetch>) =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_AGENT", "test-agent");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockClear();
    rmSync(configRoot, { recursive: true, force: true });
  });

  it("sends exactly one agent phrase when the SDK already stamped one", async () => {
    await sandboxClient
      .list({ token: "fake", teamId: "team_fake", projectId: "prj_fake" })
      .catch(() => undefined);

    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1];
    const userAgent = new Headers(init?.headers).get("user-agent") ?? "";

    expect(userAgent).toMatch(/^vercel\/sandbox-cli\//);
    expect(userAgent).toContain("vercel/sandbox/");
    expect(userAgent.match(/ agent\//g)).toHaveLength(1);
  });

  it("strips the SDK's agent phrase on a config-file opt-out", async () => {
    // `sandbox telemetry disable` writes the config file but sets no env
    // vars, so the SDK (which gates on env only) still stamps its phrase.
    // The wrapper must enforce the opt-out by stripping it from the header.
    writeTelemetryConfig(false);

    await sandboxClient
      .list({ token: "fake", teamId: "team_fake", projectId: "prj_fake" })
      .catch(() => undefined);

    const init = fetchMock.mock.calls[0]?.[1];
    const userAgent = new Headers(init?.headers).get("user-agent") ?? "";

    expect(userAgent).toMatch(/^vercel\/sandbox-cli\//);
    expect(userAgent).toContain("vercel/sandbox/");
    expect(userAgent).not.toContain(" agent/");
  });
});

describe("getAuthHeaders", () => {
  const fetchMock = vi.fn(
    async (..._args: Parameters<typeof globalThis.fetch>) =>
      new Response("{}", { status: 200 }),
  );

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    setGetAuthHeaders(undefined);
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const list = () =>
    sandboxClient
      .list({ token: "vca_fake", teamId: "team_fake", projectId: "prj_fake" })
      .catch(() => undefined);

  it("replaces the Bearer header with new headers for every attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    let proof = 0;
    const getAuthHeaders = vi.fn(async () => ({
      authorization: "DPoP vca_fake",
      dpop: `proof-${++proof}`,
    }));
    setGetAuthHeaders(getAuthHeaders);

    await list();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const [first, second] = fetchMock.mock.calls.map(
      (call) => new Headers(call[1]?.headers),
    );
    expect(first.get("authorization")).toBe("DPoP vca_fake");
    expect(first.get("dpop")).toBe("proof-1");
    expect(second.get("dpop")).toBe("proof-2");
    const [method, url] = getAuthHeaders.mock.calls[0] as unknown as [
      string,
      string,
    ];
    expect(method).toBe("GET");
    expect(url).toMatch(/^https:\/\/vercel\.com\/api\/v\d+\/sandboxes/);
  });

  it("sends Bearer without a getAuthHeaders", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await list();

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer vca_fake");
    expect(headers.has("dpop")).toBe(false);
  });
});
