import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseClient } from "./base-client.js";

class TestClient extends BaseClient {
  constructor(params: ConstructorParameters<typeof BaseClient>[0]) {
    super(params);
  }

  async probe(path = "/test") {
    return this.request(path);
  }
}

describe("BaseClient fetch dispatcher", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("does not pass a custom undici dispatcher when a custom fetch is injected", async () => {
    const client = new TestClient({
      baseUrl: "https://example.com",
      fetch: mockFetch,
    });

    await client.probe();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    expect(init).not.toHaveProperty("dispatcher");
  });
});
