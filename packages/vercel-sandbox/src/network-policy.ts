/**
 * Network policy to define network restrictions for the sandbox.
 *
 * - `"allow-all"`: Full internet access (default). All traffic is allowed.
 * - `"deny-all"`: No internet access. All traffic is denied.
 * - Object: Custom access with explicit allow/deny lists.
 *
 * @example
 * // Full internet access (default)
 * "allow-all"
 *
 * @example
 * // No external access
 * "deny-all"
 *
 * @example
 * // Custom access with specific domains
 * // All traffic not explicitly allowed is denied.
 * {
 *   allow: ["*.npmjs.org", "github.com"],
 *   subnets: {
 *     allow: ["10.0.0.0/8"],
 *     deny: ["10.1.0.0/16"]
 *   }
 * }
 */
export type NetworkPolicy =
  | "allow-all"
  | "deny-all"
  | {
      /**
       * List of domains to allow traffic to.
       * Use "*" prefix for wildcard matching (e.g., "*.npmjs.org").
       */
      allow?: string[];
      /**
       * Subnet-level access control using CIDR notation.
       */
      subnets?: {
        /**
         * List of CIDRs to allow traffic to.
         * Traffic to these addresses will bypass the domain allowlist.
         */
        allow?: string[];
        /**
         * List of CIDRs to deny traffic to.
         * These take precedence over allowed domains and CIDRs.
         */
        deny?: string[];
      };
    };
