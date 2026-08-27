import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sandboxClient } from "./client";

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
});
