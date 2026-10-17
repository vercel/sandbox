import { describe, expect, test, vi } from "vitest";
import {
  gatewayPolicy,
  gatewayTags,
  gatewayAgent,
  gatewayEnv,
  checkGatewayEnv,
  gatewayHost,
  gatewayKeyFingerprint,
} from "../../src/util/agent-gateway/policy";
import {
  configureFile,
  agentFiles,
  prepareAgent,
} from "../../src/util/agent-gateway/config";
import { parse } from "smol-toml";

const secret = "test-only-real-credential";
describe("Gateway preparation", () => {
  test("puts authentication only in the exact-host firewall rule", () => {
    const policy = gatewayPolicy("allow-all", secret);
    expect(policy).toEqual({
      allow: {
        "*": [],
        [gatewayHost]: [
          {
            transform: [
              {
                headers: {
                  authorization: `Bearer ${secret}`,
                  host: gatewayHost,
                },
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(gatewayEnv("claude"))).not.toContain(secret);
  });
  test("preserves restricted access and subnet denials during initial setup", () => {
    const original = {
      allow: [gatewayHost, "registry.npmjs.org"],
      subnets: { deny: ["10.0.0.0/8"] },
    };
    const policy = gatewayPolicy(original, secret);
    const next = policy;
    expect(next).toMatchObject({
      subnets: original.subnets,
      allow: { "registry.npmjs.org": [] },
    });
    expect(Object.keys((next as any).allow)).toEqual([
      gatewayHost,
      "registry.npmjs.org",
    ]);
    expect(JSON.stringify(next)).toContain(secret);
    expect(original.allow).toEqual([gatewayHost, "registry.npmjs.org"]);
  });
  test("rejects policies that cannot safely compose", () => {
    for (const policy of [
      "deny-all",
      { allow: ["example.com"] },
      { allow: [gatewayHost], subnets: { allow: ["0.0.0.0/0"] } },
      { allow: { [gatewayHost]: [{ forwardURL: "https://example.com" }] } },
      {
        allow: {
          [gatewayHost]: [],
          "example.com": [
            { transform: [{ headers: { authorization: "REDACTED" } }] },
          ],
        },
      },
    ] as const) {
      expect(() => gatewayPolicy(policy as any, secret)).toThrow();
    }
  });
  test("does not replace a custom matcher on reconnect", () => {
    const policy: any = gatewayPolicy("allow-all", secret);
    policy.allow[gatewayHost][0].match = { path: { exact: "/v1/models" } };
    expect(() => gatewayPolicy(policy, "new")).toThrow(/custom/);
  });
  test("preserves tag capacity and rejects unsupported marker versions", () => {
    expect(gatewayAgent(gatewayTags({ user: "value" }, "codex", secret))).toBe(
      "codex",
    );
    expect(() => gatewayTags({ "sandbox-ai": "user" }, "pi", secret)).toThrow();
    expect(() =>
      gatewayTags({ a: "1", b: "2", c: "3", d: "4", e: "5" }, "pi", secret),
    ).toThrow();
    expect(() => gatewayAgent({ "sandbox-ai": "v2:codex" })).toThrow();
    expect(gatewayTags({}, "pi", secret)["sandbox-ai"]).toBe(
      `v2:pi:${gatewayKeyFingerprint(secret)}`,
    );
    expect(JSON.stringify(gatewayTags({}, "pi", secret))).not.toContain(secret);
  });
  test("rejects user auth and configuration overrides before they can enter the VM", () => {
    expect(() => checkGatewayEnv({ AI_GATEWAY_API_KEY: secret })).toThrow();
    expect(() => checkGatewayEnv({ CODEX_HOME: "/tmp/elsewhere" })).toThrow();
    expect(() => checkGatewayEnv({ NODE_ENV: "test" })).not.toThrow();
  });
  test.each(["codex", "claude", "opencode", "pi"] as const)(
    "%s configuration is idempotent and has no real credential",
    (agent) => {
      for (const file of agentFiles(agent)) {
        const first = configureFile(agent, file, null);
        expect(configureFile(agent, file, first)).toBe(first);
        expect(first).not.toContain(secret);
      }
    },
  );
  test("preserves unrelated Codex settings and selected model", () => {
    const content = configureFile(
      "codex",
      agentFiles("codex")[0],
      'model = "openai/custom"\napproval_policy = "on-request"\n[projects."/work"]\ntrust_level = "trusted"\n',
    );
    expect(parse(content)).toMatchObject({
      model: "openai/custom",
      approval_policy: "on-request",
      projects: { "/work": { trust_level: "trusted" } },
      model_provider: "vercel",
    });
  });
  test("preserves Pi history settings and only replaces Gateway auth", () => {
    const content = configureFile(
      "pi",
      agentFiles("pi")[0],
      JSON.stringify({ anthropic: { type: "oauth", refresh: "unrelated" } }),
    );
    expect(JSON.parse(content).anthropic.refresh).toBe("unrelated");
  });
});

test("preparation handles image directories that already exist", async () => {
  const s = {
    readFileToBuffer: vi.fn().mockResolvedValue(null),
    fs: { mkdir: vi.fn().mockResolvedValue(undefined) },
    writeFiles: vi.fn().mockResolvedValue(undefined),
  };
  await prepareAgent(s as any, "codex");
  expect(s.fs.mkdir).toHaveBeenCalledWith("/vercel/.codex", {
    recursive: true,
  });
  expect(s.writeFiles).toHaveBeenCalledOnce();
});

test("all-agent setup validates all five files before writing and preserves unrelated settings", async () => {
  const existing = new Map<string, Buffer>();
  const sandbox = {
    readFileToBuffer: vi.fn(
      async ({ path }: { path: string }) => existing.get(path) ?? null,
    ),
    fs: { mkdir: vi.fn() },
    writeFiles: vi.fn(async (files: { path: string; content: Buffer }[]) => {
      for (const file of files) existing.set(file.path, file.content);
    }),
  };
  await prepareAgent(sandbox as any, "all");
  expect(existing.size).toBe(5);
  await prepareAgent(sandbox as any, "all");
  expect(sandbox.writeFiles).toHaveBeenCalledOnce();
  existing.set("/vercel/.pi/agent/settings.json", Buffer.from("invalid json"));
  existing.delete("/vercel/.codex/config.toml");
  await expect(prepareAgent(sandbox as any, "all")).rejects.toThrow(
    /Cannot parse/,
  );
  expect(sandbox.writeFiles).toHaveBeenCalledOnce();
});
