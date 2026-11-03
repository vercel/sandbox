import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    create: mockCreate,
    fork: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

vi.mock("../../src/commands/login", () => ({
  login: { handler: vi.fn() },
}));

describe("create command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      name: "my-sandbox",
      interactivePort: 8443,
      routes: [],
    });
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  test("forwards --network-id to Sandbox.create", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, [
      "--network-id=network_123",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ networkId: "network_123" }),
    );
  });

  test("defaults the network policy to allow-all", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, ["--scope=team", "--project=proj", "--silent"]);

    expect(mockCreate.mock.calls[0][0].networkPolicy).toBe("allow-all");
  });

  test("sends a request header policy from the environment", async () => {
    vi.stubEnv("NPM_AUTH", "Bearer npm_abc==");
    try {
      const { create } = await import("../../src/commands/create.ts");
      await cmd.run(create, [
        "--request-header-from-env",
        "registry.npmjs.org:authorization=NPM_AUTH",
        "--scope=team",
        "--project=proj",
        "--silent",
      ]);

      expect(mockCreate.mock.calls[0][0].networkPolicy).toEqual({
        allow: {
          "registry.npmjs.org": [
            {
              transform: [{ headers: { authorization: "Bearer npm_abc==" } }],
            },
          ],
        },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("sends the policy from --network-policy-file", async () => {
    const policy = {
      allow: {
        "registry.npmjs.org": [
          {
            match: { method: ["GET", "HEAD"] },
            transform: [{ headers: { authorization: "Bearer npm_abc==" } }],
          },
        ],
      },
    };
    const path = join(mkdtempSync(join(tmpdir(), "policy-")), "policy.json");
    writeFileSync(path, JSON.stringify(policy));
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, [
      "--network-policy-file",
      path,
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockCreate.mock.calls[0][0].networkPolicy).toEqual(policy);
  });

  test("sends a request header policy", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, [
      "--request-header",
      "registry.npmjs.org:authorization=Bearer npm_abc==",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockCreate.mock.calls[0][0].networkPolicy).toEqual({
      allow: {
        "registry.npmjs.org": [
          {
            transform: [{ headers: { authorization: "Bearer npm_abc==" } }],
          },
        ],
      },
    });
  });
});
