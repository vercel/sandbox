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
      "only one of transform, forwardURL, or response can be used per rule",
    );
  });

  it("rejects rules without transform, forwardURL, or response", () => {
    const networkPolicy = {
      allow: {
        "api.example.com": [{ match: { method: ["GET"] } }],
      },
    } as unknown as NetworkPolicy;

    expect(() => toAPINetworkPolicy(networkPolicy)).toThrow(
      "transform, forwardURL, or response must be provided",
    );
  });

  it("converts a path allowlist built from a trailing response rule", () => {
    const networkPolicy: NetworkPolicy = {
      allow: {
        "api.github.com": [
          {
            match: { path: { startsWith: "/repos/my-org/" } },
            transform: [{ headers: { authorization: "Bearer secret" } }],
          },
          { response: { statusCode: 403 } },
        ],
      },
    };

    expect(toAPINetworkPolicy(networkPolicy)).toEqual(networkPolicy);
  });

  it("converts a response rule with a body", () => {
    const networkPolicy: NetworkPolicy = {
      allow: {
        "api.example.com": [
          {
            response: {
              statusCode: 451,
              headers: { "x-denied-by": "policy" },
              body: '{"error":"blocked"}',
              contentType: "application/json",
            },
          },
        ],
      },
    };

    expect(toAPINetworkPolicy(networkPolicy)).toEqual(networkPolicy);
  });

  it("rejects rules with response and transform", () => {
    const networkPolicy = {
      allow: {
        "api.example.com": [
          {
            transform: [{ headers: { authorization: "Bearer secret" } }],
            response: { statusCode: 403 },
          },
        ],
      },
    } as unknown as NetworkPolicy;

    expect(() => toAPINetworkPolicy(networkPolicy)).toThrow(
      "only one of transform, forwardURL, or response can be used per rule",
    );
  });

  it("rejects a response status code outside 200 to 599", () => {
    const networkPolicy = {
      allow: { "api.example.com": [{ response: { statusCode: 100 } }] },
    } as unknown as NetworkPolicy;

    expect(() => toAPINetworkPolicy(networkPolicy)).toThrow();
  });

  it("rejects a response body without a contentType", () => {
    const networkPolicy = {
      allow: { "api.example.com": [{ response: { statusCode: 403, body: "nope" } }] },
    } as unknown as NetworkPolicy;

    expect(() => toAPINetworkPolicy(networkPolicy)).toThrow(
      "contentType must be provided when body is set",
    );
  });

  it("rejects a response body on a bodyless status code", () => {
    const networkPolicy = {
      allow: {
        "api.example.com": [
          { response: { statusCode: 204, body: "nope", contentType: "text/plain" } },
        ],
      },
    } as unknown as NetworkPolicy;

    expect(() => toAPINetworkPolicy(networkPolicy)).toThrow(
      "body is not allowed on status codes 204, 205, and 304",
    );
  });

  it("rejects a response that sets a proxy-managed header", () => {
    const networkPolicy = {
      allow: {
        "api.example.com": [
          { response: { statusCode: 403, headers: { "Content-Length": "0" } } },
        ],
      },
    } as unknown as NetworkPolicy;

    expect(() => toAPINetworkPolicy(networkPolicy)).toThrow(
      "headers cannot set proxy-managed headers",
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
