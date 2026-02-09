import { z } from "zod";
import { NetworkPolicy } from "../network-policy";
import { NetworkPolicyValidator } from "../api-client/validators";

type APINetworkPolicy = z.infer<typeof NetworkPolicyValidator>;

export function toAPINetworkPolicy(policy: NetworkPolicy): APINetworkPolicy {
  if (policy === "allow-all") return { mode: "allow-all" };
  if (policy === "deny-all") return { mode: "deny-all" };
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
