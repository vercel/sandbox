import { describe, expect, it } from "vitest";
import { toAPINetworkPolicy, fromAPINetworkPolicy } from "./network-policy";

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

  it("roundtrips through both conversions", () => {
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
});
