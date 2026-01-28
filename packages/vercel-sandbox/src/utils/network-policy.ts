import type {
  APINetworkPolicy,
  InjectionRule,
} from "../api-client/api-client";

export type { InjectionRule };

/**
 * Network policy to define network restrictions for the sandbox.
 *
 * - `internet-access`: Full internet access (default). All traffic is allowed.
 * - `no-access`: No internet access. All traffic is denied.
 * - `restricted`: Restricted access with explicit allow/deny lists.
 *
 * @example
 * // Full internet access (default)
 * { type: "internet-access" }
 *
 * @example
 * // No internet access
 * { type: "no-access" }
 *
 * @example
 * // Restricted access with specific domains
 * // All traffic not explicitly allowed is denied.
 * {
 *   type: "restricted",
 *   allowedDomains: ["*.npmjs.org", "github.com"],
 *   allowedCIDRs: ["10.0.0.0/8"],
 *   deniedCIDRs: ["10.1.0.0/16"]
 * }
 *
 * @example
 * // Internet access with header injection
 * {
 *   type: "internet-access",
 *   injectionRules: [
 *     { domain: "api.example.com", headers: { "Authorization": "Bearer token" } }
 *   ]
 * }
 */
export type NetworkPolicy =
  | {
      type: "internet-access";
      /**
       * Rules to inject HTTP headers for requests matching specific domains.
       * Supports wildcards like *.example.com for domain matching.
       */
      injectionRules?: InjectionRule[];
    }
  | {
      type: "no-access";
      /**
       * Rules to inject HTTP headers for requests matching specific domains.
       * Supports wildcards like *.example.com for domain matching.
       */
      injectionRules?: InjectionRule[];
    }
  | {
      type: "restricted";
      /**
       * List of domains to allow traffic to.
       * Use "*" prefix for wildcard matching (e.g., "*.npmjs.org").
       */
      allowedDomains?: string[];
      /**
       * List of CIDRs to allow traffic to.
       * Traffic to these addresses will bypass the domain allowlist.
       */
      allowedCIDRs?: string[];
      /**
       * List of CIDRs to deny traffic to.
       * These take precedence over allowed domains and CIDRs.
       */
      deniedCIDRs?: string[];
      /**
       * Rules to inject HTTP headers for requests matching specific domains.
       * Supports wildcards like *.example.com for domain matching.
       */
      injectionRules?: InjectionRule[];
    };

/**
 * Converts the SDK NetworkPolicy to the API format.
 */
export function toAPINetworkPolicy(
  policy: NetworkPolicy | undefined,
): APINetworkPolicy | undefined {
  if (!policy) {
    return undefined;
  }

  switch (policy.type) {
    case "internet-access":
      return {
        mode: "default-allow",
        injectionRules: policy.injectionRules,
      };
    case "no-access":
      return {
        mode: "default-deny",
        injectionRules: policy.injectionRules,
      };
    case "restricted":
      return {
        mode: "default-deny",
        allowedDomains: policy.allowedDomains,
        allowedCIDRs: policy.allowedCIDRs,
        deniedCIDRs: policy.deniedCIDRs,
        injectionRules: policy.injectionRules,
      };
  }
}
