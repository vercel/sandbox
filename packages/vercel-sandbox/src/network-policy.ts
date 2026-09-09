/**
 * A transform applied to network requests matching a domain rule.
 *
 * @example
 * {
 *   headers: { authorization: "Bearer sk-..." }
 * }
 */
export type NetworkTransformer = {
  /** Headers to set on the outgoing request. */
  headers?: Record<string, string>;
};

/**
 * Defines how a request value is matched.
 */
export type NetworkPolicyMatcher = {
  /** Match the value exactly. */
  exact?: string;
} | {
  /** Match values that start with the provided prefix. */
  startsWith?: string;
} | {
  /** Match values against an RE2 regular expression. */
  regex?: string;
};

/**
 * Matcher for key/value request entries such as headers and query parameters.
 */
export type NetworkPolicyKeyValueMatcher = {
  /** Matcher for the entry key. */
  key?: NetworkPolicyMatcher;
  /** Matcher for the entry value. */
  value?: NetworkPolicyMatcher;
};

/**
 * Request matcher for a network policy rule.
 *
 * All specified dimensions must match. Multiple methods are ORed; multiple
 * header and query-string matchers are ANDed.
 */
export type NetworkPolicyMatch = {
  /** Match on the request path. */
  path?: NetworkPolicyMatcher;
  /** Match on the HTTP method. */
  method?: string[];
  /** Match on query-string entries. */
  queryString?: NetworkPolicyKeyValueMatcher[];
  /** Match on request headers. */
  headers?: NetworkPolicyKeyValueMatcher[];
};

/**
 * A response the sandbox network proxy returns itself, without contacting the
 * destination. Use it to deny the requests an allowed domain's earlier rules
 * did not claim, since allowing a domain otherwise allows every request to it.
 */
export type NetworkPolicyResponse = {
  /** Status code to answer with, between 200 and 599. */
  statusCode: number;
  /** Response headers. Proxy-managed headers are rejected. */
  headers?: Record<string, string>;
  /** Response body. Requires `contentType`, and is not allowed on 204, 205, or 304. */
  body?: string;
  /** Content type for `body`. Required whenever `body` is set. */
  contentType?: string;
};

/**
 * A rule applied to requests matching a domain in the network policy.
 */
export type NetworkPolicyRule = {
  /**
   * Optional request matcher. When provided, the rule only applies to requests
   * that match every specified dimension. A rule without `match` applies to
   * every request to the domain.
   */
  match?: NetworkPolicyMatch;
} & (
  | {
      /**
       * Transforms to apply to matching requests.
       *
       * `transform` cannot be used together with `forwardURL` or `response`.
       */
      transform: NetworkTransformer[];
      forwardURL?: never;
      response?: never;
    }
  | {
      transform?: never;
      response?: never;
      /**
       * HTTPS proxy URL to forward matching requests to. Must not include query string or fragment.
       *
       * You can use the `defineSandboxProxy` helper from `@vercel/sandbox/proxy` to implement the proxy handler
       * automatically, which handles authorization and extracts metadata about the request and sandbox.
       *
       * `forwardURL` cannot be used together with `transform` or `response`.
       *
       * @see https://vercel.com/docs/vercel-sandbox/concepts/firewall#requests-proxying
       */
      forwardURL: string;
    }
  | {
      transform?: never;
      forwardURL?: never;
      /**
       * Answer matching requests from the proxy instead of contacting the destination.
       *
       * Rules run in declaration order, so a trailing `response` rule with no `match`
       * answers whatever the earlier rules did not claim. This is how you restrict an
       * allowed domain to specific paths without running a proxy of your own.
       *
       * `response` cannot be used together with `transform` or `forwardURL`.
       */
      response: NetworkPolicyResponse;
    }
);

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
 * // Custom access with specific domains (simple list)
 * // All traffic not explicitly allowed is denied.
 * {
 *   allow: ["*.npmjs.org", "github.com"],
 *   subnets: {
 *     allow: ["10.0.0.0/8"],
 *     deny: ["10.1.0.0/16"]
 *   }
 * }
 *
 * @example
 * // Custom access with specific domains (record form)
 * {
 *   allow: {
 *     "*.npmjs.org": [],
 *     "github.com": [],
 *   }
 * }
 *
 * @example
 * // Custom access with request transformers
 * {
 *   allow: {
 *     "ai-gateway.vercel.sh": [
 *       {
 *         match: {
 *           method: ["POST"],
 *           path: { startsWith: "/v1/" },
 *           headers: [
 *             { key: { exact: "x-api-key" }, value: { exact: "placeholder" } }
 *           ]
 *         },
 *         transform: [{
 *           headers: { authorization: "Bearer ..." }
 *         }]
 *       }
 *     ],
 *     "*": []
 *   }
 * }
 */
export type NetworkPolicy =
  | "allow-all"
  | "deny-all"
  | {
      /**
       * Domains to allow traffic to.
       * Use "*" prefix for wildcard matching (e.g., "*.npmjs.org").
       *
       * Accepts either:
       * - `string[]`: A simple list of domains to allow.
       * - `Record<string, NetworkPolicyRule[]>`: A map of domains to rules.
       *   An empty array allows traffic with no additional rules.
       */
      allow?: string[] | Record<string, NetworkPolicyRule[]>;
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
