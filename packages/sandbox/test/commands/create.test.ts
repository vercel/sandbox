import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { mockCreate, mockListNpmRegistries } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockListNpmRegistries: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    create: mockCreate,
    fork: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
  fetchWithUserAgent: vi.fn(),
}));

vi.mock("@vercel/sandbox/api-client", () => ({
  APIClient: vi.fn(() => ({ listNpmRegistries: mockListNpmRegistries })),
}));

vi.mock("../../src/util/check-latest-version", () => ({
  startLatestVersionCheck: () => ({ report: vi.fn() }),
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

  test("requests the team's npm credentials with --credentials=npm", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, [
      "--credentials=npm",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { npm: true } }),
    );
  });

  async function createWithNpmPreview(registries: unknown[]) {
    mockListNpmRegistries.mockResolvedValue({ json: { registries } });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const { create } = await import("../../src/commands/create.ts");
      await cmd.run(create, [
        "--credentials=npm",
        "--scope=team",
        "--project=proj",
      ]);
      return stderr.mock.calls.flat().join("");
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  }

  test("lists the team's npm registries after creating with --credentials=npm", async () => {
    const output = await createWithNpmPreview([
      { scope: null, url: "https://registry.npmjs.org/" },
      { scope: "@acme", url: "https://npm.pkg.github.com/" },
    ]);

    expect(output).toContain(
      "npm: https://registry.npmjs.org/, https://npm.pkg.github.com/ (@acme/*)",
    );
  });

  test("warns when the team has no npm credentials", async () => {
    const output = await createWithNpmPreview([]);

    expect(output).toContain("npm: this team has no npm credentials");
  });

  test("strips terminal escapes from team registry URLs", async () => {
    const output = await createWithNpmPreview([
      { scope: null, url: "https://registry.npmjs.org/\u001b]8;;evil\u0007" },
    ]);

    expect(output).toContain("https://registry.npmjs.org/]8;;evil");
    expect(output).not.toContain("\u001b");
  });

  test("rejects credentials it does not support, listing the supported ones", async () => {
    const { credentialProviderListType } = await import(
      "../../src/args/credentials.ts"
    );

    await expect(credentialProviderListType.from("npm,github")).rejects.toThrow(
      "Unsupported credentials: github. Supported: npm.",
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
