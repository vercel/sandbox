import { z } from "zod";
import { NetworkPolicy } from "../network-policy";
import { NetworkPolicyValidator } from "../api-client/validators";

type APINetworkPolicy = z.infer<typeof NetworkPolicyValidator>;

export function toAPINetworkPolicy(policy: NetworkPolicy): APINetworkPolicy {
  if (policy === "allow-all") return { mode: "allow-all" };
  if (policy === "deny-all") return { mode: "deny-all" };

  if (policy.allow && !Array.isArray(policy.allow)) {
    const allowedDomains = Object.keys(policy.allow);
    const injectionRules: Array<{
      domain: string;
      headers: Record<string, string>;
    }> = [];

    for (const [domain, rules] of Object.entries(policy.allow)) {
      const merged: Record<string, string> = {};
      for (const rule of rules) {
        for (const t of rule.transform ?? []) {
          Object.assign(merged, t.headers);
        }
      }
      if (Object.keys(merged).length > 0) {
        injectionRules.push({ domain, headers: merged });
      }
    }

    return {
      mode: "custom",
      ...(allowedDomains.length > 0 && { allowedDomains }),
      ...(injectionRules.length > 0 && { injectionRules }),
      ...(policy.subnets?.allow && { allowedCIDRs: policy.subnets.allow }),
      ...(policy.subnets?.deny && { deniedCIDRs: policy.subnets.deny }),
    };
  }

  return {
    mode: "custom",
    ...(policy.allow && { allowedDomains: policy.allow }),
    ...(policy.subnets?.allow && { allowedCIDRs: policy.subnets.allow }),
    ...(policy.subnets?.deny && { deniedCIDRs: policy.subnets.deny }),
  };
}

export function fromAPINetworkPolicy(api: APINetworkPolicy): NetworkPolicy {
  if (api.mode === "allow-all") return "allow-all";
  if (api.mode === "deny-all") return "deny-all";
  
  return {
    ...(api.allowedDomains && { allow: api.allowedDomains }),
    ...((api.allowedCIDRs || api.deniedCIDRs) && {
      subnets: {
        ...(api.allowedCIDRs && { allow: api.allowedCIDRs }),
        ...(api.deniedCIDRs && { deny: api.deniedCIDRs }),
      },
    }),
  };
}
