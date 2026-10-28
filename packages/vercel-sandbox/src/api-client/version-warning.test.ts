import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIClient } from "./api-client.js";
import { startSdkVersionCheck } from "../utils/check-sdk-version.js";

vi.mock("../utils/check-sdk-version.js", () => ({
  startSdkVersionCheck: vi.fn(),
}));
vi.mock("../utils/detect-agent.js", () => ({
  detectAgentName: vi.fn(async () => undefined),
}));

class TestClient extends APIClient {
  perform() {
    return this.request("/test", { retry: { retries: 0 } });
  }
}

describe("SDK version check at the API boundary", () => {
  const report = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(startSdkVersionCheck).mockReturnValue({ report });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts on a request, never on construction, and reports after the response", async () => {
    const client = new TestClient({ teamId: "team_123", token: "test-token" });
    expect(startSdkVersionCheck).not.toHaveBeenCalled();
    const response = await client.perform();
    expect(response.status).toBe(200);
    expect(startSdkVersionCheck).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://vercel.com/api/test"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("reports and cancels even when the API request fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("API offline"));
    const client = new TestClient({ teamId: "team_123", token: "test-token" });
    await expect(client.perform()).rejects.toThrow("API offline");
    expect(report).toHaveBeenCalledOnce();
  });

  it("does not bypass a custom fetch implementation, including the CLI transport", async () => {
    const customFetch = vi.fn(async () => new Response("{}"));
    const client = new TestClient({
      teamId: "team_123",
      token: "test-token",
      fetch: customFetch,
    });
    await client.perform();
    expect(customFetch).toHaveBeenCalledOnce();
    expect(startSdkVersionCheck).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not add npm requests to custom API endpoints", async () => {
    const client = new TestClient({
      teamId: "team_123",
      token: "test-token",
      baseUrl: "http://localhost:1234",
    });
    await client.perform();
    expect(startSdkVersionCheck).not.toHaveBeenCalled();
  });
});
