import { z } from "zod";
import { NetworkPolicy, NetworkPolicyRule } from "../network-policy.js";
import {
  NetworkPolicyValidator,
  InjectionRuleValidator,
} from "../api-client/validators.js";

type APINetworkPolicy = z.infer<typeof NetworkPolicyValidator>;

export function toAPINetworkPolicy(policy: NetworkPolicy): APINetworkPolicy {
  if (policy === "allow-all") return { mode: "allow-all" };
  if (policy === "deny-all") return { mode: "deny-all" };

  if (policy.allow && !Array.isArray(policy.allow)) {
    const allowedDomains = Object.keys(policy.allow);
    const injectionRules: z.infer<typeof InjectionRuleValidator>[] = [];

    for (const [domain, rules] of Object.entries(policy.allow)) {
      if (rules.some((rule) => rule.match !== undefined)) {
        for (const rule of rules) {
          const headers = mergeTransformHeaders(rule);
          if (Object.keys(headers).length > 0) {
            injectionRules.push({
              domain,
              headers,
              ...(rule.match ? { match: rule.match } : {}),
            });
          }
        }
      } else {
        const headers = rules.reduce(
          (merged, rule) => Object.assign(merged, mergeTransformHeaders(rule)),
          {} as Record<string, string>,
        );
        if (Object.keys(headers).length > 0) {
          injectionRules.push({ domain, headers });
        }
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

function mergeTransformHeaders(rule: NetworkPolicyRule): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const transform of rule.transform ?? []) {
    Object.assign(headers, transform.headers);
  }
  return headers;
}

export function fromAPINetworkPolicy(api: APINetworkPolicy): NetworkPolicy {
  if (api.mode === "allow-all") return "allow-all";
  if (api.mode === "deny-all") return "deny-all";

  const subnets =
    api.allowedCIDRs || api.deniedCIDRs
      ? {
          subnets: {
            ...(api.allowedCIDRs && { allow: api.allowedCIDRs }),
            ...(api.deniedCIDRs && { deny: api.deniedCIDRs }),
          },
        }
      : undefined;

  // If injectionRules are present, reconstruct the record form.
  // The API returns headerNames (secret values are stripped), so we
  // populate each header value with "<redacted>".
  if (api.injectionRules && api.injectionRules.length > 0) {
    const rulesByDomain = new Map<string, NetworkPolicyRule[]>();
    for (const rule of api.injectionRules) {
      const headers = Object.fromEntries(
        (rule.headerNames ?? []).map((n) => [n, "<redacted>"]),
      );
      const rules = rulesByDomain.get(rule.domain) ?? [];
      rules.push({
        ...(rule.match ? { match: rule.match } : {}),
        transform: [{ headers }],
      });
      rulesByDomain.set(rule.domain, rules);
    }

    const allow: Record<string, NetworkPolicyRule[]> = {};
    for (const domain of api.allowedDomains ?? []) {
      allow[domain] = rulesByDomain.get(domain) ?? [];
    }
    // Include injection rules for domains not in allowedDomains
    for (const rule of api.injectionRules) {
      if (!(rule.domain in allow)) {
        allow[rule.domain] = rulesByDomain.get(rule.domain) ?? [];
      }
    }

    return { allow, ...subnets };
  }

  return {
    ...(api.allowedDomains && { allow: api.allowedDomains }),
    ...subnets,
  };
}
