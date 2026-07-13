import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, test, vi } from "vitest";
import {
  Sandbox,
  Session,
  Command,
  CommandFinished,
  command,
  Snapshot,
  APIError,
  StreamError,
  FileSystem,
  defineSandboxProxy,
  setupSandbox,
} from "../src";

test("exports Sandbox class", () => {
  expect(Sandbox).toBeDefined();
  expect(Sandbox).toHaveProperty("create");
  expect(Sandbox).toHaveProperty("get");
  expect(Sandbox).toHaveProperty("list");
});

test("exports Session class", () => {
  expect(Session).toBeDefined();
});

test("exports Command classes", () => {
  expect(Command).toBeDefined();
  expect(CommandFinished).toBeDefined();
});

test("exports command handler helper", () => {
  expect(command).toBeTypeOf("function");
});

test("exports the FileSystem class used by sandbox.fs", async () => {
  const sandbox = await Sandbox.create();
  expect(sandbox.fs).toBeInstanceOf(FileSystem);
  await sandbox.stop();
});

test("exports Snapshot class with sourceSessionId", () => {
  expect(Snapshot).toBeDefined();
  const snap = new Snapshot("id", "session-id");
  expect(snap.sourceSessionId).toBe("session-id");
  expect(snap.snapshotId).toBe("id");
});

test("Snapshot.tree() returns a paginated ancestry anchor", async () => {
  const result = await Snapshot.tree({ snapshotId: "snapshot-root" });

  expect(result.snapshots).toHaveLength(1);
  expect(result.snapshots[0]).toMatchObject({
    snapshot: {
      id: "snapshot-root",
      sourceSessionId: "mock-session",
      region: "mock",
      status: "created",
    },
    siblings: [],
    count: "1",
  });
  expect(result.anchor).toEqual(result.snapshots[0]);
  expect(await result.toArray()).toEqual(result.snapshots);
});

test("exports error classes", () => {
  expect(APIError).toBeDefined();
  expect(StreamError).toBeDefined();
  expect(new APIError(new Response(null, { status: 500 }))).toBeInstanceOf(Error);
  expect(new StreamError("code", "msg", "id")).toBeInstanceOf(Error);
});

test("exports setupSandbox", () => {
  expect(setupSandbox).toBeTypeOf("function");
});

test("defineSandboxProxy preserves the request body and removes internal headers", async () => {
  const issuer = "https://oidc.vercel.com/sandbox-mock-test";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { alg: "RS256", kid: "test-key", use: "sig" });
  const token = await new SignJWT({
    team_id: "team_123",
    project_id: "prj_123",
    sandbox_id: "sbx_123",
    sandbox_name: "workspace",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience("https://proxy.example/api/forward")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ keys: [jwk] }));
  const proxy = defineSandboxProxy(async (request, meta) =>
    Response.json({
      url: request.url,
      method: request.method,
      body: await request.text(),
      host: request.headers.get("host"),
      internalHeaders: {
        host: request.headers.get("vercel-forwarded-host"),
        scheme: request.headers.get("vercel-forwarded-scheme"),
        port: request.headers.get("vercel-forwarded-port"),
        path: request.headers.get("vercel-forwarded-path"),
        oidcToken: request.headers.get("vercel-sandbox-oidc-token"),
      },
      clientHeader: request.headers.get("x-client-header"),
      meta,
    }),
  );

  const response = await proxy(
    new Request("https://proxy.example/api/forward/hello", {
      method: "POST",
      headers: {
        "vercel-forwarded-host": "service.internal",
        "vercel-forwarded-scheme": "https",
        "vercel-forwarded-port": "443",
        "vercel-forwarded-path": "/hello?answer=42",
        "vercel-sandbox-oidc-token": token,
        "x-client-header": "preserved",
      },
      body: "request body",
    }),
  );

  expect(await response.json()).toEqual({
    url: "https://service.internal/hello?answer=42",
    method: "POST",
    body: "request body",
    host: "service.internal",
    internalHeaders: {
      host: null,
      scheme: null,
      port: null,
      path: null,
      oidcToken: null,
    },
    clientHeader: "preserved",
    meta: {
      host: "proxy.example",
      teamId: "team_123",
      projectId: "prj_123",
      sandboxId: "sbx_123",
      sandboxName: "workspace",
    },
  });
  fetchMock.mockRestore();
});

test("defineSandboxProxy sanitizes requests passed to the invalid-request handler", async () => {
  const invalidRequestHandler = vi.fn((request: Request, error: Error) =>
    Response.json(
      {
        message: error.message,
        internalHeaders: {
          host: request.headers.get("vercel-forwarded-host"),
          scheme: request.headers.get("vercel-forwarded-scheme"),
          port: request.headers.get("vercel-forwarded-port"),
          path: request.headers.get("vercel-forwarded-path"),
          oidcToken: request.headers.get("vercel-sandbox-oidc-token"),
        },
      },
      { status: 422 },
    ),
  );
  const proxy = defineSandboxProxy(() => new Response("trusted"), invalidRequestHandler);

  const response = await proxy(
    new Request("https://proxy.example/api/forward", {
      headers: {
        "vercel-forwarded-host": "service.internal",
        "vercel-forwarded-scheme": "https",
        "vercel-forwarded-path": "/",
        "vercel-sandbox-oidc-token": "sensitive-token",
      },
    }),
  );

  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    message: "Missing required proxy headers",
    internalHeaders: {
      host: null,
      scheme: null,
      port: null,
      path: null,
      oidcToken: null,
    },
  });
  expect(invalidRequestHandler).toHaveBeenCalledOnce();
});

test("defineSandboxProxy rejects signed tokens with invalid authorization claims", async () => {
  const issuer = "https://oidc.vercel.com/sandbox-mock-invalid-tests";
  const audience = "https://proxy.example/api/forward";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { alg: "RS256", kid: "invalid-test-key", use: "sig" });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ keys: [jwk] }));
  const trustedHandler = vi.fn(() => new Response("trusted"));
  const proxy = defineSandboxProxy(trustedHandler);
  const baseClaims = {
    team_id: "team_123",
    project_id: "prj_123",
    sandbox_id: "sbx_123",
    sandbox_name: "workspace",
  };
  const sign = async ({
    claims = baseClaims,
    tokenIssuer = issuer,
    tokenAudience = audience,
    expiration = Math.floor(Date.now() / 1000) + 300,
  }: {
    claims?: Record<string, string>;
    tokenIssuer?: string;
    tokenAudience?: string;
    expiration?: number;
  }) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "invalid-test-key" })
      .setIssuer(tokenIssuer)
      .setAudience(tokenAudience)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .sign(privateKey);

  const tokens = [
    await sign({ tokenAudience: "https://wrong.example" }),
    await sign({ expiration: Math.floor(Date.now() / 1000) - 120 }),
    await sign({ claims: { team_id: "team_123", project_id: "prj_123" } }),
    await sign({ tokenIssuer: "https://example.com/not-vercel" }),
  ];

  for (const token of tokens) {
    const response = await proxy(
      new Request("https://proxy.example/api/forward/hello", {
        headers: {
          "vercel-forwarded-host": "service.internal",
          "vercel-forwarded-scheme": "https",
          "vercel-forwarded-port": "443",
          "vercel-forwarded-path": "/hello",
          "vercel-sandbox-oidc-token": token,
        },
      }),
    );
    expect(response.status).toBe(403);
  }

  expect(trustedHandler).not.toHaveBeenCalled();
  fetchMock.mockRestore();
});

test("defineSandboxProxy rejects unsigned OIDC claims", async () => {
  const claims = Buffer.from(
    JSON.stringify({
      team_id: "team_123",
      project_id: "prj_123",
      sandbox_id: "sbx_123",
    }),
  ).toString("base64url");
  const proxy = defineSandboxProxy(() => new Response("trusted"));
  const response = await proxy(
    new Request("https://proxy.example/api/forward", {
      headers: {
        "vercel-forwarded-host": "service.internal",
        "vercel-forwarded-scheme": "https",
        "vercel-forwarded-port": "443",
        "vercel-forwarded-path": "/",
        "vercel-sandbox-oidc-token": `header.${claims}.signature`,
      },
    }),
  );

  expect(response.status).toBe(403);
  expect(await response.text()).toBe("Forbidden");
});
