import type { APINetworkPolicy } from "../api-client/api-client";

/**
 * Network policy to define network restrictions for the sandbox.
 *
 * - `allow-all`: Full internet access (default). All traffic is allowed.
 * - `deny-all`: No internet access. All traffic is denied.
 * - `custom`: custom access with explicit allow/deny lists.
 *
 * @example
 * // Full internet access (default)
 * { mode: "allow-all" }
 *
 * @example
 * // No external access
 * { mode: "deny-all" }
 *
 * @example
 * // custom access with specific domains
 * // All traffic not explicitly allowed is denied.
 * {
 *   mode: "custom",
 *   allowedDomains: ["*.npmjs.org", "github.com"],
 *   allowedCIDRs: ["10.0.0.0/8"],
 *   deniedCIDRs: ["10.1.0.0/16"]
 * }
 */
export type NetworkPolicy =
  | { mode: "allow-all" } & Record<string, unknown>
  | { mode: "deny-all" } & Record<string, unknown>
  | ({
      mode: "custom";
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
    } & Record<string, unknown>);

/**
 * Converts the SDK NetworkPolicy to the API format.
 */
export function toAPINetworkPolicy(
  policy: NetworkPolicy | undefined,
): APINetworkPolicy | undefined {
  if (!policy) {
    return undefined;
  }

  const { mode, ...rest } = policy;
  switch (mode) {
    case "allow-all":
      return { ...rest, mode: "default-allow" };
    case "deny-all":
      return { ...rest, mode: "default-deny" };
    case "custom": {
      return { ...rest, mode: "default-deny" };
    }
  }
}
