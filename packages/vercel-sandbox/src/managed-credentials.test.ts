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

  it.each([
    [true, "write"],
    ["read" as const, "read-only"],
  ])("carries source.credentials %s for a %s managed clone", async (value) => {
    const mockFetch = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 403 }),
    );
    await expect(
      Sandbox.create({
        ...auth,
        source: {
          type: "git",
          url: "https://github.com/acme/widgets.git",
          credentials: value,
        },
        fetch: mockFetch,
      }),
    ).rejects.toBeInstanceOf(APIError);
    const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
    expect(body.source).toEqual({
      type: "git",
      url: "https://github.com/acme/widgets.git",
      credentials: value,
    });
  });

  it("keeps a read-only source free of commit metadata the caller omitted", async () => {
    const mockFetch = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 403 }),
    );
    await expect(
      Sandbox.create({
        ...auth,
        source: {
          type: "git",
          url: "https://github.com/acme/widgets.git",
          credentials: "read",
        },
        credentials: { github: [] },
        fetch: mockFetch,
      }),
    ).rejects.toBeInstanceOf(APIError);
    const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty("commitAs");
    expect(body.source.credentials).toBe("read");
  });

  it("reads back the managed-credential request the API reports", async () => {
    // Pinned against the real response validators: the CLI's configuration
    // reuse reads this through `currentSession()`, so a field that the schema
    // strips would silently break it.
    const managedCredentials = {
      source: {
        type: "git" as const,
        url: "https://github.com/acme/widgets.git",
        credentials: "read" as const,
      },
      commitAs: { name: "Grace Hopper", email: "grace@example.com" },
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["github:issues:read"],
            actAs: "42",
          },
        ],
      },
    };
    const mockFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            sandbox: {
              name: "mock-sandbox",
              persistent: true,
              currentSessionId: "sbx_test",
              status: "running",
              createdAt: 1,
              updatedAt: 1,
            },
            session: {
              id: "sbx_test",
              memory: 2048,
              vcpus: 6,
              region: "iad1",
              timeout: 300000,
              status: "running",
              requestedAt: 1,
              createdAt: 1,
              updatedAt: 1,
              cwd: "/vercel",
              interactivePort: 8443,
              managedCredentials,
            },
            routes: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const sandbox = await Sandbox.create({ ...auth, fetch: mockFetch });

    expect(sandbox.currentSession().managedCredentials).toEqual(
      managedCredentials,
    );
  });

  it("reports no managed-credential request for an ordinary sandbox", async () => {
    const mockFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            sandbox: {
              name: "mock-sandbox",
              persistent: true,
              currentSessionId: "sbx_test",
              status: "running",
              createdAt: 1,
              updatedAt: 1,
            },
            session: {
              id: "sbx_test",
              memory: 2048,
              vcpus: 1,
              region: "iad1",
              timeout: 300000,
              status: "running",
              requestedAt: 1,
              createdAt: 1,
              updatedAt: 1,
              cwd: "/vercel",
              interactivePort: 8443,
            },
            routes: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const sandbox = await Sandbox.create({ ...auth, fetch: mockFetch });

    expect(sandbox.currentSession().managedCredentials).toBeUndefined();
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
