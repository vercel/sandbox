import { describe, expect, it } from "vitest";
import type { NetworkPolicy } from "../network-policy.js";
import { fromAPINetworkPolicy, toAPINetworkPolicy } from "./network-policy.js";

describe("toAPINetworkPolicy", () => {
  it("converts allow-all", () => {
    expect(toAPINetworkPolicy("allow-all")).toEqual({ mode: "allow-all" });
  });

  it("converts deny-all", () => {
    expect(toAPINetworkPolicy("deny-all")).toEqual({ mode: "deny-all" });
  });

  it("converts custom with only allowed domains", () => {
    expect(
      toAPINetworkPolicy({ allow: ["*.npmjs.org", "github.com"] }),
    ).toEqual({
      allow: ["*.npmjs.org", "github.com"],
    });
  });

  it("converts custom with only subnets", () => {
    expect(
      toAPINetworkPolicy({
        subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
      }),
    ).toEqual({
      subnets: {
        allow: ["10.0.0.0/8"],
        deny: ["10.1.0.0/16"],
      },
    });
  });

  it("converts custom with all fields", () => {
    expect(
      toAPINetworkPolicy({
        allow: ["github.com"],
        subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
      }),
    ).toEqual({
      allow: ["github.com"],
      subnets: {
        allow: ["10.0.0.0/8"],
        deny: ["10.1.0.0/16"],
      },
    });
  });

  it("converts record-form domains to allow map", () => {
    expect(
      toAPINetworkPolicy({
        allow: { "api.github.com": [], "github.com": [] },
      }),
    ).toEqual({
      allow: { "api.github.com": [], "github.com": [] },
    });
  });

  it("keeps record-form rules in v2 allow-map shape", () => {
    expect(
      toAPINetworkPolicy({
        allow: {
          "api.github.com": [
            {
              transform: [
                {
                  headers: {
                    authorization: "Bearer sk-openai",
                    "x-org-id": "org-123",
                  },
                },
              ],
            },
          ],
          "ai-gateway.vercel.sh": [
            {
              transform: [
                { headers: { "x-api-key": "sk-ant-test" } },
                { headers: { "anthropic-version": "2024-01-01" } },
              ],
            },
          ],
          "registry.npmjs.org": [],
          "*": [],
        },
        subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
      }),
    ).toEqual({
      allow: {
        "api.github.com": [
          {
            transform: [
              {
                headers: {
                  authorization: "Bearer sk-openai",
                  "x-org-id": "org-123",
                },
              },
            ],
          },
        ],
        "ai-gateway.vercel.sh": [
          {
            transform: [
              { headers: { "x-api-key": "sk-ant-test" } },
              { headers: { "anthropic-version": "2024-01-01" } },
            ],
          },
        ],
        "registry.npmjs.org": [],
        "*": [],
      },
      subnets: {
        allow: ["10.0.0.0/8"],
        deny: ["10.1.0.0/16"],
      },
    });
  });

  it("preserves matcher-bearing rules as ordered allow-map transform rules", () => {
    expect(
      toAPINetworkPolicy({
        allow: {
          "api.example.com": [
            {
              match: {
                method: ["POST"],
                path: { startsWith: "/v1/" },
                headers: [
                  {
                    key: { exact: "x-api-key" },
                    value: { exact: "placeholder" },
                  },
                ],
              },
              transform: [{ headers: { "x-api-key": "real-secret" } }],
            },
            {
              transform: [{ headers: { "x-api-key": "fallback-secret" } }],
            },
          ],
        },
      }),
    ).toEqual({
      allow: {
        "api.example.com": [
          {
            match: {
              method: ["POST"],
              path: { startsWith: "/v1/" },
              headers: [
                {
                  key: { exact: "x-api-key" },
                  value: { exact: "placeholder" },
                },
              ],
            },
            transform: [{ headers: { "x-api-key": "real-secret" } }],
          },
          {
            transform: [{ headers: { "x-api-key": "fallback-secret" } }],
          },
        ],
      },
    });
  });

  it("converts record-form forwardURL rules to allow-map forwardURL rules", () => {
    expect(
      toAPINetworkPolicy({
        allow: {
          "api.example.com": [
            {
              match: {
                method: ["POST"],
                path: { startsWith: "/v1/" },
              },
              forwardURL: "https://proxy.example.com",
            },
            {
              forwardURL: "https://fallback-proxy.example.com",
            },
          ],
          "registry.npmjs.org": [],
        },
      }),
    ).toEqual({
      allow: {
        "api.example.com": [
          {
            match: {
              method: ["POST"],
              path: { startsWith: "/v1/" },
            },
            forwardURL: "https://proxy.example.com",
          },
          {
            forwardURL: "https://fallback-proxy.example.com",
          },
        ],
        "registry.npmjs.org": [],
      },
    });
  });

  it("rejects rules with transform and forwardURL", () => {
    const networkPolicy = {
      allow: {
        "api.example.com": [
          {
            transform: [{ headers: { authorization: "Bearer secret" } }],
            forwardURL: "https://proxy.example.com",
          },
        ],
      },
    } as unknown as NetworkPolicy;

    expect(() => toAPINetworkPolicy(networkPolicy)).toThrow(
      "transform and forwardURL cannot be used together",
    );
  });

  it("rejects rules without transform or forwardURL", () => {
    const networkPolicy = {
      allow: {
        "api.example.com": [{ match: { method: ["GET"] } }],
      },
    } as unknown as NetworkPolicy;

    expect(() => toAPINetworkPolicy(networkPolicy)).toThrow(
      "transform or forwardURL must be provided",
    );
  });

  it("converts empty custom object", () => {
    expect(toAPINetworkPolicy({})).toEqual({});
  });

  it("omits undefined subnet fields", () => {
    expect(toAPINetworkPolicy({ subnets: { allow: ["10.0.0.0/8"] } })).toEqual({
      subnets: { allow: ["10.0.0.0/8"] },
    });
  });
});

describe("fromAPINetworkPolicy", () => {
  it("converts allow-all", () => {
    expect(fromAPINetworkPolicy({ mode: "allow-all" })).toBe("allow-all");
  });

  it("converts deny-all", () => {
    expect(fromAPINetworkPolicy({ mode: "deny-all" })).toBe("deny-all");
  });

  it("converts custom with only allowedDomains", () => {
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedDomains: ["*.npmjs.org", "github.com"],
      }),
    ).toEqual({ allow: ["*.npmjs.org", "github.com"] });
  });

  it("converts custom with only CIDRs", () => {
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedCIDRs: ["10.0.0.0/8"],
        deniedCIDRs: ["10.1.0.0/16"],
      }),
    ).toEqual({
      subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
    });
  });

  it("converts custom with all fields", () => {
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedDomains: ["github.com"],
        allowedCIDRs: ["10.0.0.0/8"],
        deniedCIDRs: ["10.1.0.0/16"],
      }),
    ).toEqual({
      allow: ["github.com"],
      subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
    });
  });

  it("converts custom with no fields", () => {
    expect(fromAPINetworkPolicy({ mode: "custom" })).toEqual({});
  });

  it("parses legacy/mode-form responses", () => {
    expect(fromAPINetworkPolicy({ mode: "allow-all" })).toEqual("allow-all");
    expect(fromAPINetworkPolicy({ mode: "deny-all" })).toEqual("deny-all");
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedDomains: ["github.com"],
      }),
    ).toEqual({ allow: ["github.com"] });
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedCIDRs: ["10.0.0.0/8"],
        deniedCIDRs: ["10.1.0.0/16"],
      }),
    ).toEqual({
      subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
    });
  });

  it("converts injectionRules with multiple domains, headers, and subnets", () => {
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedDomains: [
          "api.github.com",
          "ai-gateway.vercel.sh",
          "registry.npmjs.org",
          "*",
        ],
        injectionRules: [
          {
            domain: "api.github.com",
            headerNames: ["authorization", "x-foo"],
          },
          {
            domain: "ai-gateway.vercel.sh",
            headerNames: ["authorization", "x-bar"],
          },
        ],
        allowedCIDRs: ["10.0.0.0/8"],
        deniedCIDRs: ["10.1.0.0/16"],
      }),
    ).toEqual({
      allow: {
        "api.github.com": [
          {
            transform: [
              {
                headers: { authorization: "<redacted>", "x-foo": "<redacted>" },
              },
            ],
          },
        ],
        "ai-gateway.vercel.sh": [
          {
            transform: [
              {
                headers: { authorization: "<redacted>", "x-bar": "<redacted>" },
              },
            ],
          },
        ],
        "registry.npmjs.org": [],
        "*": [],
      },
      subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
    });
  });

  it("converts ordered injectionRules with matchers", () => {
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedDomains: ["api.example.com"],
        injectionRules: [
          {
            domain: "api.example.com",
            headerNames: ["x-api-key"],
            match: {
              method: ["POST"],
              path: { startsWith: "/v1/" },
              queryString: [{ key: { exact: "model" } }],
            },
          },
          {
            domain: "api.example.com",
            headerNames: ["x-api-key"],
          },
        ],
      }),
    ).toEqual({
      allow: {
        "api.example.com": [
          {
            match: {
              method: ["POST"],
              path: { startsWith: "/v1/" },
              queryString: [{ key: { exact: "model" } }],
            },
            transform: [{ headers: { "x-api-key": "<redacted>" } }],
          },
          {
            transform: [{ headers: { "x-api-key": "<redacted>" } }],
          },
        ],
      },
    });
  });

  it("converts forwardRules with matchers", () => {
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedDomains: ["api.example.com", "registry.npmjs.org"],
        forwardRules: [
          {
            domain: "api.example.com",
            match: {
              method: ["POST"],
              path: { startsWith: "/v1/" },
              headers: [{ key: { exact: "x-route" }, value: { exact: "proxy" } }],
            },
            forwardURL: "https://proxy.example.com",
          },
          {
            domain: "api.example.com",
            forwardURL: "https://fallback-proxy.example.com",
          },
        ],
      }),
    ).toEqual({
      allow: {
        "api.example.com": [
          {
            match: {
              method: ["POST"],
              path: { startsWith: "/v1/" },
              headers: [{ key: { exact: "x-route" }, value: { exact: "proxy" } }],
            },
            forwardURL: "https://proxy.example.com",
          },
          {
            forwardURL: "https://fallback-proxy.example.com",
          },
        ],
        "registry.npmjs.org": [],
      },
    });
  });

  it("converts mixed injectionRules and forwardRules", () => {
    expect(
      fromAPINetworkPolicy({
        mode: "custom",
        allowedDomains: ["api.example.com"],
        injectionRules: [
          {
            domain: "api.example.com",
            headerNames: ["authorization"],
          },
        ],
        forwardRules: [
          {
            domain: "api.example.com",
            forwardURL: "https://proxy.example.com",
          },
          {
            domain: "proxy-only.example.com",
            forwardURL: "https://proxy-only.example.com",
          },
        ],
      }),
    ).toEqual({
      allow: {
        "api.example.com": [
          {
            transform: [{ headers: { authorization: "<redacted>" } }],
          },
          {
            forwardURL: "https://proxy.example.com",
          },
        ],
        "proxy-only.example.com": [
          {
            forwardURL: "https://proxy-only.example.com",
          },
        ],
      },
    });
  });
});
