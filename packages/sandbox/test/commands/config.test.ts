import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { stripVTControlCharacters } from "node:util";
import * as cmd from "cmd-ts";

const { mockGet, mockUpdate } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    get: mockGet,
    create: vi.fn(),
    fork: vi.fn(),
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

const fakeSandbox = (overrides: Record<string, unknown> = {}) => ({
  name: "my-sandbox",
  region: "sfo1",
  failoverRegions: ["iad1", "cle1"],
  vcpus: 2,
  timeout: 300_000,
  persistent: true,
  networkPolicy: "restricted",
  networkId: "network_123",
  interactivePort: 8443,
  routes: [],
  tags: undefined,
  update: mockUpdate,
  ...overrides,
});

describe("config command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(fakeSandbox());
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  test("region updates the sandbox region", async () => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "region",
      "my-sandbox",
      "cle1",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({ region: "cle1" });
  });

  test("failover-regions splits, trims, and de-duplicates the list", async () => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "failover-regions",
      "my-sandbox",
      "sfo1, iad1,sfo1",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({
      failoverRegions: ["sfo1", "iad1"],
    });
  });

  test("mounts sends the parsed mounts to the SDK", async () => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "mounts",
      "my-sandbox",
      "--mount=data:/mnt/data:snapshot",
      "--mount=cache:/mnt/cache",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({
      mounts: {
        "/mnt/data": { drive: "data", mode: "snapshot" },
        "/mnt/cache": { drive: "cache", mode: "read-write" },
      },
    });
  });

  test("mounts without --mount clears the mounts", async () => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "mounts",
      "my-sandbox",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({ mounts: {} });
  });

  test('failover-regions "none" clears the failover regions', async () => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "failover-regions",
      "my-sandbox",
      "none",
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({ failoverRegions: [] });
  });

  test.each([
    ["network_456", "network_456"],
    ["none", null],
  ])("network-id updates with %s", async (value, networkId) => {
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "network-id",
      "my-sandbox",
      value,
      "--scope=team",
      "--project=proj",
    ]);

    expect(mockUpdate).toHaveBeenCalledWith({ networkId });
  });

  test.each([
    ["network_456", "network_456"],
    ["none", null],
  ])("config network command updates with %s", async (value, networkId) => {
    const { app } = await import("../../src/app.ts");
    const args = [
      "config",
      "network",
      "my-sandbox",
      value,
      "--scope=team",
      "--project=proj",
    ];
    await cmd.run(await app(args, { withoutAuth: true }), args);

    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "my-sandbox",
        teamId: "team",
        projectId: "proj",
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith({ networkId });
  });

  test("config network rejects an empty ID without updating", async () => {
    const { app } = await import("../../src/app.ts");
    const args = [
      "config",
      "network",
      "my-sandbox",
      " ",
      "--scope=team",
      "--project=proj",
    ];
    await expect(
      cmd.run(await app(args, { withoutAuth: true }), args),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("list prints the region and the failover regions", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "list",
      "my-sandbox",
      "--scope=team",
      "--project=proj",
    ]);

    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("sfo1");
    expect(output).toContain("iad1, cle1");
    expect(output).toContain("network_123");
    log.mockRestore();
  });

  test("list dashes empty failover regions", async () => {
    mockGet.mockResolvedValue(fakeSandbox({ failoverRegions: [] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { config } = await import("../../src/commands/config.ts");
    await cmd.run(config, [
      "list",
      "my-sandbox",
      "--scope=team",
      "--project=proj",
    ]);

    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toMatch(/Failover regions\s+-/);
    log.mockRestore();
  });

  describe("network-policy", () => {
    const secret = "Bearer npm_abc==";

    beforeEach(() => {
      process.env.NPM_AUTH = secret;
      process.env.NPM_TEAM = "acme";
      vi.spyOn(process, "exit").mockImplementation((code?: number) => {
        throw new Error(`process.exit:${code ?? 0}`);
      });
    });

    afterEach(() => {
      delete process.env.NPM_AUTH;
      delete process.env.NPM_TEAM;
      vi.restoreAllMocks();
    });

    async function runPolicy(args: string[]) {
      const chunks: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        chunks.push(String(chunk));
        return true;
      });
      vi.spyOn(console, "error").mockImplementation((...parts) => {
        chunks.push(parts.map(String).join(" "));
      });
      const { config } = await import("../../src/commands/config.ts");
      try {
        await cmd.run(config, [
          "network-policy",
          "my-sbx",
          ...args,
          "--scope=team",
          "--project=proj",
        ]);
        return {
          failed: false,
          output: stripVTControlCharacters(chunks.join("\n")),
        };
      } catch (error) {
        if (
          !(error instanceof Error && error.message.startsWith("process.exit:"))
        ) {
          const { printTopLevelError } = await import(
            "../../src/util/format-error.ts"
          );
          await printTopLevelError(error);
        }
        return {
          failed: true,
          error,
          output: stripVTControlCharacters(chunks.join("\n")),
        };
      }
    }

    function tree(output: string): string {
      const lines = output
        .split("\n")
        .map((line) => line.replace(/\r/g, ""))
        .filter((line) => line.length > 0);
      const start = lines.findIndex((line) =>
        line.startsWith("✅ Network policy updated"),
      );
      if (start < 0) {
        return "";
      }
      const picked = [lines[start]];
      for (const line of lines.slice(start + 1)) {
        if (line.startsWith("   │ ") || line.startsWith("   ╰ ")) {
          picked.push(line);
        } else {
          break;
        }
      }
      return picked.join("\n");
    }

    test("updates with the exact policy and the header tree", async () => {
      mockGet.mockResolvedValue(fakeSandbox({ name: "my-sbx" }));
      const result = await runPolicy([
        "--allowed-domain",
        "*",
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(false);
      expect(mockUpdate).toHaveBeenCalledWith({
        networkPolicy: {
          allow: {
            "registry.npmjs.org": [
              {
                transform: [{ headers: { authorization: "Bearer npm_abc==" } }],
              },
            ],
            "*": [],
          },
        },
      });
      expect(tree(result.output)).toBe(
        [
          "✅ Network policy updated for sandbox my-sbx",
          "   │ mode: restricted",
          "   ╰ request headers: registry.npmjs.org (authorization)",
        ].join("\n"),
      );
      expect(result.output).not.toContain("npm_abc");
      expect(result.output).not.toContain(secret);
    });

    test("keeps the single mode line when no header is set", async () => {
      mockGet.mockResolvedValue(fakeSandbox({ name: "my-sbx" }));
      const result = await runPolicy(["--network-policy", "allow-all"]);

      expect(result.failed).toBe(false);
      expect(mockUpdate).toHaveBeenCalledWith({ networkPolicy: "allow-all" });
      expect(tree(result.output)).toBe(
        [
          "✅ Network policy updated for sandbox my-sbx",
          "   ╰ mode: allow-all",
        ].join("\n"),
      );
      expect(result.output).not.toContain("request headers:");
    });

    test("sends the unchanged string allow list when no header is set", async () => {
      mockGet.mockResolvedValue(fakeSandbox({ name: "my-sbx" }));
      const result = await runPolicy(["--allowed-domain", "github.com"]);

      expect(result.failed).toBe(false);
      expect(mockUpdate).toHaveBeenCalledWith({
        networkPolicy: { allow: ["github.com"] },
      });
      expect(tree(result.output)).toBe(
        [
          "✅ Network policy updated for sandbox my-sbx",
          "   ╰ mode: restricted",
        ].join("\n"),
      );
    });

    test("rejects an unset variable before update", async () => {
      delete process.env.NPM_AUTH;
      const result = await runPolicy([
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain(
        "Environment variable NPM_AUTH is not set for header authorization on registry.npmjs.org.",
      );
      expect(result.output).not.toContain(secret);
    });

    test("rejects an empty variable before update", async () => {
      process.env.NPM_AUTH = "";
      const result = await runPolicy([
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain(
        "Environment variable NPM_AUTH is empty for header authorization on registry.npmjs.org.",
      );
    });

    test("rejects an inline value before update", async () => {
      const result = await runPolicy([
        "--request-header",
        "registry.npmjs.org:authorization=Bearer ZZINLINESECRET",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain("Invalid --request-header value.");
    });

    test("rejects a bad env var name before update", async () => {
      const result = await runPolicy([
        "--request-header",
        "registry.npmjs.org:authorization:has space",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain(
        "Invalid environment variable name in --request-header.",
      );
      expect(result.output).not.toContain(secret);
    });

    test("rejects a bad header token before update", async () => {
      const result = await runPolicy([
        "--request-header",
        "registry.npmjs.org:bad header:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain(
        "Invalid header name for environment variable NPM_AUTH.",
      );
      expect(result.output).not.toContain(secret);
    });

    test("rejects a reserved domain character before update", async () => {
      const result = await runPolicy([
        "--request-header",
        "ZZSECRETZZ/v1:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain(
        "Path and method matchers are not supported by the CLI yet. Use the SDK's networkPolicy rules.",
      );
      expect(result.output).not.toContain(secret);
    });

    test("rejects a leading bracket before update", async () => {
      const result = await runPolicy([
        "--request-header",
        "[ZZSECRETZZ.com:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain(
        "Path and method matchers are not supported by the CLI yet. Use the SDK's networkPolicy rules.",
      );
      expect(result.output).not.toContain(secret);
    });

    test("rejects a carriage return in the value before update", async () => {
      process.env.NPM_AUTH = "ZZSECRETZZ\rmore";
      const result = await runPolicy([
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain(
        "Environment variable NPM_AUTH contains a carriage return or line feed.",
      );
      expect(result.output).not.toContain("ZZSECRETZZ");
    });

    test("rejects a line feed in the value before update", async () => {
      process.env.NPM_AUTH = "ZZSECRETZZ\nmore";
      const result = await runPolicy([
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output).toContain(
        "Environment variable NPM_AUTH contains a carriage return or line feed.",
      );
      expect(result.output).not.toContain("ZZSECRETZZ");
    });

    test("rejects allow-all combined with a header before update", async () => {
      const result = await runPolicy([
        "--network-policy",
        "allow-all",
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output.trim()).toBe(
        [
          "Cannot combine --network-policy=allow-all with --request-header.",
          "hint: To set request headers and keep every other domain allowed, replace --network-policy=allow-all with --allowed-domain '*'.",
        ].join("\n"),
      );
      expect(result.output).not.toContain(secret);
    });

    test("rejects deny-all combined with a header before update", async () => {
      const result = await runPolicy([
        "--network-policy",
        "deny-all",
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output.trim()).toBe(
        [
          "Cannot combine --network-policy=deny-all with --request-header.",
          "hint: Drop --network-policy. A custom policy already denies every domain it does not allow.",
        ].join("\n"),
      );
      expect(result.output).not.toContain(secret);
    });

    test("rejects --mode allow-all combined with a header before update", async () => {
      const result = await runPolicy([
        "--mode",
        "allow-all",
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output.trim()).toBe(
        [
          "Cannot combine --network-policy=allow-all with --request-header.",
          "hint: To set request headers and keep every other domain allowed, replace --network-policy=allow-all with --allowed-domain '*'.",
        ].join("\n"),
      );
      expect(result.output).not.toContain(secret);
    });

    test("rejects a duplicate header before update", async () => {
      const result = await runPolicy([
        "--request-header",
        "registry.npmjs.org:authorization:NPM_AUTH",
        "--request-header",
        "registry.npmjs.org:Authorization:NPM_TEAM",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output.trim()).toBe(
        [
          'Duplicate request header "authorization" for registry.npmjs.org.',
          "hint: Pass each header once per domain. Header names are case-insensitive.",
        ].join("\n"),
      );
      expect(result.output).not.toContain(secret);
      expect(result.output).not.toContain("acme");
    });

    test("rejects a missing policy before update", async () => {
      const result = await runPolicy([]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output.trim()).toBe(
        "Network policy mode or custom rules must be set.",
      );
    });

    test("rejects a mode combined with a domain list before update", async () => {
      const result = await runPolicy([
        "--network-policy",
        "allow-all",
        "--allowed-domain",
        "github.com",
      ]);

      expect(result.failed).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result.output.trim()).toBe(
        [
          "Cannot combine --network-policy=allow-all with --allowed-domain, --allowed-cidr, or --denied-cidr.",
          "hint: Use --allowed-domain / --allowed-cidr / --denied-cidr without --network-policy for custom policies.",
        ].join("\n"),
      );
    });
  });
});
