import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { mockCreate, mockHasProjectBounds, mockInferGithubRepository } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockHasProjectBounds: vi.fn(),
    mockInferGithubRepository: vi.fn(),
  }));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    create: mockCreate,
    fork: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
}));

vi.mock("../../src/util/github-repository", () => ({
  inferGithubRepository: mockInferGithubRepository,
}));

vi.mock("../../src/util/project-bounds", () => ({
  hasProjectBounds: mockHasProjectBounds,
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
    mockHasProjectBounds.mockResolvedValue(true);
    mockInferGithubRepository.mockResolvedValue("acme/local");
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

  test("rejects credentials it does not support, listing the supported ones", async () => {
    const { credentialProviderListType } = await import(
      "../../src/args/credentials.ts"
    );

    await expect(credentialProviderListType.from("npm,gitlab")).rejects.toThrow(
      "Unsupported credentials: gitlab. Supported: npm, github.",
    );
  });

  test("--credentials=github requests the default access to the local repository", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, [
      "--credentials=github",
      "--yes",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          github: [
            {
              repositories: ["acme/local"],
              actions: [
                "github:issues:read",
                "github:issues:comment",
                "github:pull-request:create",
                "git:write",
              ],
            },
          ],
        },
        source: { type: "git", url: "https://github.com/acme/local.git" },
      }),
    );
  });

  test("requests GitHub credentials and clones the repository", async () => {
    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, [
      "--credentials=npm",
      "--credentials-github-repository=acme/web",
      "--credentials-github-actions=git:write,pull-request:create",
      "--credentials-github-act-as=octocat",
      "--yes",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          npm: true,
          github: [
            {
              repositories: ["acme/web"],
              actions: ["git:write", "github:pull-request:create"],
              actAs: "@octocat",
            },
          ],
        },
        source: { type: "git", url: "https://github.com/acme/web.git" },
      }),
    );
    expect(mockHasProjectBounds).toHaveBeenCalledWith({
      token: "tok",
      team: "team",
      project: "proj",
    });
  });

  test("stops before creating when GitHub credentials are not confirmed", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { create } = await import("../../src/commands/create.ts");

    try {
      await expect(
        cmd.run(create, [
          "--credentials-github-repository=acme/web",
          "--scope=team",
          "--project=proj",
          "--silent",
        ]),
      ).rejects.toThrow(
        "Can't create a sandbox with GitHub credentials without confirmation in non-interactive mode.",
      );
      expect(stderr.mock.calls.join("")).toContain(
        "  Repository      acme/web\n",
      );
      expect(stderr.mock.calls.join("")).toContain(
        "    sandbox create --scope=team --project=proj --credentials-github-repository=acme/web --credentials-github-actions=github:issues:read,github:issues:comment,github:pull-request:create,git:write\n",
      );
    } finally {
      stderr.mockRestore();
    }
    expect(mockHasProjectBounds).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("sends the credentials from --credentials-file", async () => {
    const credentials = {
      github: [
        { repositories: ["acme/web", "acme/api"], actions: ["git:read"] },
      ],
    };
    const path = join(
      mkdtempSync(join(tmpdir(), "credentials-")),
      "credentials.json",
    );
    writeFileSync(path, JSON.stringify(credentials));

    const { create } = await import("../../src/commands/create.ts");
    await cmd.run(create, [
      `--credentials-file=${path}`,
      "-y",
      "--scope=team",
      "--project=proj",
      "--silent",
    ]);

    expect(mockCreate.mock.calls[0][0].credentials).toEqual(credentials);
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("source");
  });

  test("rejects a snapshot together with a repository to clone", async () => {
    const { create } = await import("../../src/commands/create.ts");

    await expect(
      cmd.run(create, [
        "--snapshot=snap_123",
        "--credentials-github-repository=acme/web",
        "--scope=team",
        "--project=proj",
        "--silent",
      ]),
    ).rejects.toThrow(
      "Cannot combine --snapshot with --credentials-github-repository.",
    );
    expect(mockCreate).not.toHaveBeenCalled();
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
