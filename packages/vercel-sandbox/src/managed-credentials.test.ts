import { describe, expect, it, vi } from "vitest";
import { Sandbox } from "./sandbox.js";
import { APIError } from "./api-client/api-error.js";

const auth = { token: "test-token", teamId: "team_123", projectId: "prj_123" };

describe("managed credential transport", () => {
  it("carries the new names through the SDK and API client without legacy aliases", async () => {
    const mockFetch = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 403 }),
    );
    const source = {
      type: "git" as const,
      url: "https://github.com/acme/widgets.git",
    };
    const commitAs = { name: "Grace Hopper", email: "grace@example.com" };
    const credentials = {
      github: [
        {
          repositories: ["acme/widgets"],
          actions: ["github:pull-request:create" as const],
          actAs: "42",
        },
        {
          repositories: ["acme/reference"],
          actions: ["github:issues:read" as const],
          actAs: "43",
        },
      ],
    };
    await expect(
      Sandbox.create({
        ...auth,
        source,
        commitAs,
        credentials,
        fetch: mockFetch,
      }),
    ).rejects.toBeInstanceOf(APIError);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/v3/sandboxes");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ source, commitAs, credentials });
    expect(body.source).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("__commitAs");
    expect(body).not.toHaveProperty("__credentials");
    expect(body).not.toHaveProperty("__source_credentials");
  });

  it.each([undefined, "node24" as const])(
    "preserves an explicit empty list with runtime %s",
    async (runtime) => {
      const mockFetch = vi.fn<typeof fetch>(
        async () => new Response("{}", { status: 403 }),
      );
      await expect(
        Sandbox.create({
          ...auth,
          runtime,
          credentials: { github: [] },
          fetch: mockFetch,
        }),
      ).rejects.toBeInstanceOf(APIError);
      const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      expect(body.credentials).toEqual({ github: [] });
      expect(body).not.toHaveProperty("commitAs");
      expect(body).not.toHaveProperty("source");
    },
  );

  it("omits managed fields when they were not supplied", async () => {
    const mockFetch = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 403 }),
    );
    await expect(
      Sandbox.create({ ...auth, fetch: mockFetch }),
    ).rejects.toBeInstanceOf(APIError);
    const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("commitAs");
  });

  it("never retries creation on a server error", async () => {
    const mockFetch = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 503 }),
    );
    await expect(
      Sandbox.create({
        ...auth,
        credentials: { github: [] },
        fetch: mockFetch,
      }),
    ).rejects.toBeInstanceOf(APIError);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("never retries creation on an uncertain network outcome", async () => {
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      Sandbox.create({
        ...auth,
        credentials: { github: [] },
        fetch: mockFetch,
      }),
    ).rejects.toThrow("fetch failed");
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
