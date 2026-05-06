import { z } from "zod";
import { NetworkPolicy, NetworkPolicyRule } from "../network-policy.js";
import {
  ForwardRuleValidator,
  InjectionRuleValidator,
  NetworkPolicyRequestValidator,
  NetworkPolicyResponseValidator,
} from "../api-client/validators.js";

type APIRequestNetworkPolicy = z.infer<typeof NetworkPolicyRequestValidator>;
type APIResponseNetworkPolicy = z.infer<typeof NetworkPolicyResponseValidator>;

export function toAPINetworkPolicy(
  policy: NetworkPolicy,
): APIRequestNetworkPolicy {
  if (policy === "allow-all" || policy === "deny-all") {
    return { mode: policy };
  }

  if (policy.allow && !Array.isArray(policy.allow)) {
    const allowedDomains = Object.keys(policy.allow);
    const injectionRules: z.infer<typeof InjectionRuleValidator>[] = [];
    const forwardRules: z.infer<typeof ForwardRuleValidator>[] = [];

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

      for (const rule of rules) {
        if (!rule.forwardURL) continue;
        forwardRules.push({
          domain,
          forwardURL: rule.forwardURL,
          ...(rule.match ? { match: rule.match } : {}),
        });
      }
    }

    return {
      mode: "custom",
      ...(allowedDomains.length > 0 && { allowedDomains }),
      ...(injectionRules.length > 0 && { injectionRules }),
      ...(forwardRules.length > 0 && { forwardRules }),
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

export function fromAPINetworkPolicy(
  api: APIResponseNetworkPolicy,
): NetworkPolicy {
  if (api.mode === "allow-all" || api.mode === "deny-all") {
    return api.mode;
  }

  const subnets =
    api.allowedCIDRs || api.deniedCIDRs
      ? {
          subnets: {
            ...(api.allowedCIDRs && { allow: api.allowedCIDRs }),
            ...(api.deniedCIDRs && { deny: api.deniedCIDRs }),
          },
        }
      : undefined;

  // If L7 rules are present, reconstruct the record form.
  // The API returns headerNames (secret values are stripped), so we
  // populate each header value with "<redacted>".
  if (
    (api.injectionRules && api.injectionRules.length > 0) ||
    (api.forwardRules && api.forwardRules.length > 0)
  ) {
    const rulesByDomain = new Map<string, NetworkPolicyRule[]>();
    for (const rule of api.injectionRules ?? []) {
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
    for (const rule of api.forwardRules ?? []) {
      const rules = rulesByDomain.get(rule.domain) ?? [];
      rules.push({
        ...(rule.match ? { match: rule.match } : {}),
        forwardURL: rule.forwardURL,
      });
      rulesByDomain.set(rule.domain, rules);
    }

    const allow: Record<string, NetworkPolicyRule[]> = {};
    for (const domain of api.allowedDomains ?? []) {
      allow[domain] = rulesByDomain.get(domain) ?? [];
    }
    // Include L7 rules for domains not in allowedDomains
    for (const rule of [...(api.injectionRules ?? []), ...(api.forwardRules ?? [])]) {
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
