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

import { sandboxClient } from "./client";
import { setAuthHeadersProvider } from "./auth-headers";
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

describe("getAuthHeaders from createApp", () => {
  const fetchMock = vi.fn(
    async (..._args: Parameters<typeof globalThis.fetch>) =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    setAuthHeadersProvider((method, url) => ({
      authorization: "DPoP vca_token",
      dpop: `proof ${method} ${new URL(url).pathname}`,
    }));
  });

  afterEach(() => {
    setAuthHeadersProvider(undefined);
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  it("authenticates requests with it when there's no token", async () => {
    await sandboxClient
      .list({ token: "", teamId: "team_fake", projectId: "prj_fake" })
      .catch(() => undefined);

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("DPoP vca_token");
    expect(headers.get("dpop")).toMatch(/^proof GET \/api\//);
    expect(headers.get("user-agent")).toMatch(/^vercel\/sandbox-cli\//);
  });

  it("sends a given token as Bearer instead", async () => {
    await sandboxClient
      .list({ token: "fake", teamId: "team_fake", projectId: "prj_fake" })
      .catch(() => undefined);

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer fake");
    expect(headers.get("dpop")).toBeNull();
  });
});
