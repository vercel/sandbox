import { z } from "zod";
import { NetworkPolicy, NetworkPolicyRule } from "../network-policy.js";
import {
  NetworkPolicyRequestValidator,
  NetworkPolicyResponseValidator,
  V2NetworkPolicyObjectValidator,
} from "../api-client/validators.js";

type APIRequestNetworkPolicy = z.infer<typeof NetworkPolicyRequestValidator>;
type APIResponseNetworkPolicy = z.infer<typeof NetworkPolicyResponseValidator>;

export function toAPINetworkPolicy(
  policy: NetworkPolicy,
): APIRequestNetworkPolicy {
  const apiPolicy =
    policy === "allow-all" || policy === "deny-all" ? { mode: policy } : policy;

  NetworkPolicyRequestValidator.parse(apiPolicy);
  return apiPolicy;
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
    for (const rule of [
      ...(api.injectionRules ?? []),
      ...(api.forwardRules ?? []),
    ]) {
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

/**
 * Thrown by {@link parseNetworkPolicy}. Each issue names a path in the input
 * and what is wrong there. Issues never include the input's values, because a
 * policy can carry credentials in its headers.
 */
export class NetworkPolicyParseError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      ["Invalid network policy:", ...issues.map((i) => `  ${i}`)].join("\n"),
    );
    this.name = "NetworkPolicyParseError";
    this.issues = issues;
  }
}

/**
 * Parses untrusted input, such as JSON a user wrote, into a
 * {@link NetworkPolicy}. It applies the same rules as `Sandbox.create` and
 * also rejects unknown keys, since a misspelled key such as `match.methods`
 * would otherwise be dropped and widen the rule to every request.
 *
 * @throws {NetworkPolicyParseError} when the input is not a valid policy.
 */
export function parseNetworkPolicy(input: unknown): NetworkPolicy {
  if (input === "allow-all" || input === "deny-all") {
    return input;
  }
  const result = V2NetworkPolicyObjectValidator.safeParse(input);
  if (!result.success) {
    throw new NetworkPolicyParseError(
      result.error.issues.flatMap((issue) => describeIssue(issue, [])),
    );
  }
  const unknown = unknownKeys(input, result.data, []);
  if (unknown.length > 0) {
    throw new NetworkPolicyParseError(
      unknown.map((path) => `${formatPath(path)}: unknown key`),
    );
  }
  // The validator checked every rule, including the one-action-per-rule
  // refinement that its inferred type does not express.
  return result.data as NetworkPolicy;
}

type Path = readonly PropertyKey[];

function describeIssue(issue: z.core.$ZodIssue, prefix: Path): string[] {
  const path = [...prefix, ...issue.path];
  if (issue.code === "invalid_union") {
    // Keep the branches whose type matched, so a bad rule under `allow` is
    // reported at the rule instead of as "Invalid input" at `allow`.
    const matched = issue.errors.filter(
      (branch) =>
        !branch.some((i) => i.code === "invalid_type" && i.path.length === 0),
    );
    if (matched.length > 0) {
      return matched.flatMap((branch) =>
        branch.flatMap((i) => describeIssue(i, path)),
      );
    }
    const expected = issue.errors.flatMap((branch) =>
      branch.flatMap((i) => (i.code === "invalid_type" ? [i.expected] : [])),
    );
    return [
      `${formatPath(path)}: Invalid input: expected ${expected.join(" or ")}`,
    ];
  }
  return [`${formatPath(path)}: ${issue.message}`];
}

function unknownKeys(input: unknown, parsed: unknown, path: Path): Path[] {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    return input.flatMap((item, i) =>
      unknownKeys(item, parsed[i], [...path, i]),
    );
  }
  if (isObject(input) && isObject(parsed)) {
    return Object.keys(input).flatMap((key) =>
      Object.hasOwn(parsed, key)
        ? unknownKeys(input[key], parsed[key], [...path, key])
        : [[...path, key]],
    );
  }
  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPath(path: Path): string {
  if (path.length === 0) {
    return "policy";
  }
  return path
    .map((key, i) =>
      typeof key === "number"
        ? `[${key}]`
        : /^[A-Za-z_$][\w$]*$/.test(String(key))
          ? `${i === 0 ? "" : "."}${String(key)}`
          : `[${JSON.stringify(String(key))}]`,
    )
    .join("");
}
