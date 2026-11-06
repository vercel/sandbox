import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  Sandbox,
  GITHUB_API_CREDENTIAL_ACTIONS,
  SANDBOX_GITHUB_CREDENTIAL_ACTIONS,
  type SandboxGithubCredentialAction,
} from "./index.js";
import type { ManagedCredentialOptions } from "./managed-credentials.js";
import type { APIClient } from "./api-client/api-client.js";
import { APIError } from "./api-client/api-error.js";

const auth = { token: "test-token", teamId: "team_123", projectId: "prj_123" };

const deniedFetch = (status = 403) =>
  vi.fn<typeof fetch>(async () => new Response("{}", { status }));

const sessionResponse = (managedCredentials?: unknown, vcpus = 1) =>
  Response.json({
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
      vcpus,
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
  });

describe("managed credential transport", () => {
  it("exports the supported create action registry", () => {
    expect(SANDBOX_GITHUB_CREDENTIAL_ACTIONS).toEqual([
      "git:write",
      "git:write-workflows",
      ...GITHUB_API_CREDENTIAL_ACTIONS,
    ]);
    expect(SANDBOX_GITHUB_CREDENTIAL_ACTIONS).not.toContain("git:read");
  });

  it("types SDK and API create actions uniformly, without source.credentials", () => {
    type CreateParams = NonNullable<Parameters<typeof Sandbox.create>[0]>;
    type GitSource = Extract<
      NonNullable<CreateParams["source"]>,
      { type: "git" }
    >;
    type GithubGroup = NonNullable<
      ManagedCredentialOptions["credentials"]
    >["github"][number];
    type ApiCreateParams = Parameters<APIClient["createSandbox"]>[0];
    type ApiGitSource = Extract<
      NonNullable<ApiCreateParams["source"]>,
      { type: "git" }
    >;
    expectTypeOf<CreateParams["credentials"]>().toEqualTypeOf<
      ManagedCredentialOptions["credentials"]
    >();
    expectTypeOf<ApiCreateParams["credentials"]>().toEqualTypeOf<
      ManagedCredentialOptions["credentials"]
    >();
    expectTypeOf<ApiGitSource>().not.toHaveProperty("credentials");
    expectTypeOf<CreateParams>().not.toHaveProperty("commitAs");
    expectTypeOf<ApiCreateParams>().not.toHaveProperty("commitAs");
    expectTypeOf<
      GithubGroup["actions"][number]
    >().toEqualTypeOf<SandboxGithubCredentialAction>();
    expectTypeOf<
      Extract<SandboxGithubCredentialAction, "git:read">
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<
        SandboxGithubCredentialAction,
        "git:write" | "git:write-workflows"
      >
    >().toEqualTypeOf<"git:write" | "git:write-workflows">();
    expectTypeOf<GitSource>().not.toHaveProperty("credentials");
  });

  it.each([undefined, "node24" as const])(
    "serializes every action, groups and plain source fields without retired options with runtime %s",
    async (runtime) => {
      const mockFetch = deniedFetch();
      const source = {
        type: "git" as const,
        url: "https://github.com/acme/widgets.git",
        revision: "main",
        depth: 1,
      };
      const credentials: ManagedCredentialOptions["credentials"] = {
        github: [
          {
            repositories: ["acme/widgets", "acme/two"],
            actions: [...SANDBOX_GITHUB_CREDENTIAL_ACTIONS],
            actAs: "42",
          },
          {
            repositories: ["acme/reference"],
            actions: ["github:issues:read"],
            actAs: "@scubbo",
          },
        ],
      };
      const options = {
        ...auth,
        runtime,
        source,
        credentials,
        commitAs: { name: "Ada", email: "ada@example.com" },
      };
      await expect(
        Sandbox.create({ ...options, fetch: mockFetch }),
      ).rejects.toBeInstanceOf(APIError);
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(String(url)).toContain(
        runtime === undefined ? "/v3/sandboxes" : "/v2/sandboxes",
      );
      const body = JSON.parse(String(init?.body));
      expect(body.source).toEqual(source);
      expect(body.credentials).toEqual(credentials);
      expect(body).not.toHaveProperty("commitAs");
      expect(body.source).not.toHaveProperty("credentials");
      expect(body).not.toHaveProperty("__commitAs");
      expect(body).not.toHaveProperty("__credentials");
      expect(body).not.toHaveProperty("__source_credentials");
    },
  );

  it.each([undefined, "node24" as const])(
    "preserves an explicit empty list with runtime %s",
    async (runtime) => {
      const mockFetch = deniedFetch();
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
    const mockFetch = deniedFetch();
    await expect(
      Sandbox.create({ ...auth, fetch: mockFetch }),
    ).rejects.toBeInstanceOf(APIError);
    const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("commitAs");
  });

  it.each([undefined, "node24" as const])(
    "never retries creation on a server error with runtime %s",
    async (runtime) => {
      const mockFetch = deniedFetch(503);
      await expect(
        Sandbox.create({
          ...auth,
          runtime,
          credentials: { github: [] },
          fetch: mockFetch,
        }),
      ).rejects.toBeInstanceOf(APIError);
      expect(mockFetch).toHaveBeenCalledOnce();
    },
  );

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
    const mockFetch = vi.fn<typeof fetch>(async () =>
      sessionResponse(managedCredentials, 6),
    );

    const sandbox = await Sandbox.create({ ...auth, fetch: mockFetch });

    expect(sandbox.currentSession().managedCredentials).toEqual(
      managedCredentials,
    );
  });

  it("reports no managed-credential request for an ordinary sandbox", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () => sessionResponse());

    const sandbox = await Sandbox.create({ ...auth, fetch: mockFetch });

    expect(sandbox.currentSession().managedCredentials).toBeUndefined();
  });

  it.each([undefined, "node24" as const])(
    "never retries creation on an uncertain network outcome with runtime %s",
    async (runtime) => {
      const mockFetch = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError("fetch failed"));
      await expect(
        Sandbox.create({
          ...auth,
          runtime,
          credentials: { github: [] },
          fetch: mockFetch,
        }),
      ).rejects.toThrow("fetch failed");
      expect(mockFetch).toHaveBeenCalledOnce();
    },
  );
});
