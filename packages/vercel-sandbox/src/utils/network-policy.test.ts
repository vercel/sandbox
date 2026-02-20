import { describe, expect, it } from "vitest";
import { fromAPINetworkPolicy, toAPINetworkPolicy } from "./network-policy";

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
      mode: "custom",
      allowedDomains: ["*.npmjs.org", "github.com"],
    });
  });

  it("converts custom with only subnets", () => {
    expect(
      toAPINetworkPolicy({
        subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
      }),
    ).toEqual({
      mode: "custom",
      allowedCIDRs: ["10.0.0.0/8"],
      deniedCIDRs: ["10.1.0.0/16"],
    });
  });

  it("converts custom with all fields", () => {
    expect(
      toAPINetworkPolicy({
        allow: ["github.com"],
        subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
      }),
    ).toEqual({
      mode: "custom",
      allowedDomains: ["github.com"],
      allowedCIDRs: ["10.0.0.0/8"],
      deniedCIDRs: ["10.1.0.0/16"],
    });
  });

  it("converts record-form domains to allowedDomains list", () => {
    expect(
      toAPINetworkPolicy({
        allow: { "api.github.com": [], "github.com": [] },
      }),
    ).toEqual({
      mode: "custom",
      allowedDomains: ["api.github.com", "github.com"],
    });
  });

  it("converts record-form with multiple domains and transforms to injectionRules", () => {
    expect(
      toAPINetworkPolicy({
        allow: {
          "api.github.com": [
            {
              transform: [
                { headers: { authorization: "Bearer sk-openai", "x-org-id": "org-123" } },
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
          headers: { authorization: "Bearer sk-openai", "x-org-id": "org-123" },
        },
        {
          domain: "ai-gateway.vercel.sh",
          headers: { "x-api-key": "sk-ant-test", "anthropic-version": "2024-01-01" },
        },
      ],
      allowedCIDRs: ["10.0.0.0/8"],
      deniedCIDRs: ["10.1.0.0/16"],
    });
  });

  it("converts empty custom object", () => {
    expect(toAPINetworkPolicy({})).toEqual({ mode: "custom" });
  });

  it("omits undefined subnet fields", () => {
    expect(
      toAPINetworkPolicy({ subnets: { allow: ["10.0.0.0/8"] } }),
    ).toEqual({
      mode: "custom",
      allowedCIDRs: ["10.0.0.0/8"],
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

  it("roundtrips string-form policies through both conversions", () => {
    const policies = [
      "allow-all" as const,
      "deny-all" as const,
      { allow: ["github.com"] },
      { subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] } },
      {
        allow: ["*.npmjs.org"],
        subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
      },
    ];

    for (const policy of policies) {
      expect(fromAPINetworkPolicy(toAPINetworkPolicy(policy))).toEqual(policy);
    }
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
              { headers: { authorization: "", "x-foo": "" } },
            ],
          },
        ],
        "ai-gateway.vercel.sh": [
          {
            transform: [
              { headers: { authorization: "", "x-bar": "" } },
            ],
          },
        ],
        "registry.npmjs.org": [],
        "*": [],
      },
      subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
    });
  });
});
