import chalk from "chalk";
import type { NetworkPolicy, NetworkPolicyRule } from "@vercel/sandbox";
import type { NetworkPolicyArgs } from "../args/network-policy";

type NetworkPolicyMode = "allow-all" | "deny-all";

/**
 * Resolves the network policy mode from --network-policy and --mode flags.
 * Errors if both are provided with conflicting values.
 */
export function resolveMode(
  networkPolicy?: NetworkPolicyMode,
  mode?: NetworkPolicyMode,
): NetworkPolicyMode | undefined {
  if (networkPolicy && mode && networkPolicy !== mode) {
    throw new Error(
      [
        `Conflicting network policy modes: --network-policy=${networkPolicy} and --mode=${mode}.`,
        `${chalk.bold("hint:")} Use only one of --network-policy or --mode.`,
      ].join("\n"),
    );
  }
  return networkPolicy ?? mode;
}

function fail(message: string, hint: string): never {
  throw new Error([message, `${chalk.bold("hint:")} ${hint}`].join("\n"));
}

function subnetFields(
  allowedCIDRs: string[],
  deniedCIDRs: string[],
): { subnets: { allow?: string[]; deny?: string[] } } | undefined {
  if (allowedCIDRs.length === 0 && deniedCIDRs.length === 0) {
    return undefined;
  }
  return {
    subnets: {
      ...(allowedCIDRs.length > 0 && { allow: allowedCIDRs }),
      ...(deniedCIDRs.length > 0 && { deny: deniedCIDRs }),
    },
  };
}

export function buildNetworkPolicy(
  args: NetworkPolicyArgs,
): NetworkPolicy | undefined {
  const {
    networkPolicy,
    allowedDomains,
    allowedCIDRs,
    deniedCIDRs,
    requestHeadersFromEnv,
  } = args;
  const requestHeaders = [...args.requestHeaders, ...requestHeadersFromEnv];

  if (networkPolicy && requestHeaders.length > 0) {
    switch (networkPolicy) {
      case "allow-all":
        fail(
          "Cannot combine --network-policy=allow-all with --request-header or --request-header-env.",
          "To set request headers and keep every other domain allowed, replace --network-policy=allow-all with --allowed-domain '*'.",
        );
      case "deny-all":
        fail(
          "Cannot combine --network-policy=deny-all with --request-header or --request-header-env.",
          "Drop --network-policy. A custom policy already denies every domain it does not allow.",
        );
      default: {
        const _exhaustive: never = networkPolicy;
        return _exhaustive;
      }
    }
  }

  const hasListOptions =
    allowedDomains.length > 0 ||
    allowedCIDRs.length > 0 ||
    deniedCIDRs.length > 0;

  if (networkPolicy && hasListOptions) {
    throw new Error(
      [
        `Cannot combine --network-policy=${networkPolicy} with --allowed-domain, --allowed-cidr, or --denied-cidr.`,
        `${chalk.bold("hint:")} Use --allowed-domain / --allowed-cidr / --denied-cidr without --network-policy for custom policies.`,
      ].join("\n"),
    );
  }

  if (networkPolicy) {
    return networkPolicy;
  }

  if (!hasListOptions && requestHeaders.length === 0) {
    return undefined;
  }

  const subnets = subnetFields(allowedCIDRs, deniedCIDRs);
  if (requestHeaders.length === 0) {
    return {
      ...(allowedDomains.length > 0 && { allow: allowedDomains }),
      ...subnets,
    };
  }

  // Null prototype so a token such as `__proto__` stays an own key.
  const byDomain = new Map<string, Record<string, string>>();
  for (const header of requestHeaders) {
    let headers = byDomain.get(header.domain);
    if (!headers) {
      headers = Object.create(null) as Record<string, string>;
      byDomain.set(header.domain, headers);
    }
    if (Object.hasOwn(headers, header.name)) {
      fail(
        `Duplicate request header "${header.name}" for ${header.domain}.`,
        "Pass each header once per domain. Header names are case-insensitive.",
      );
    }
    headers[header.name] = header.value.reveal();
  }

  const allow: Record<string, NetworkPolicyRule[]> = Object.create(null);
  for (const [domain, headers] of byDomain) {
    allow[domain] = [{ transform: [{ headers }] }];
  }
  for (const domain of allowedDomains) {
    if (!Object.hasOwn(allow, domain)) {
      allow[domain] = [];
    }
  }

  return {
    allow,
    ...subnets,
  };
}

export function formatRequestHeaderNames(
  policy: NetworkPolicy | undefined,
): string | undefined {
  if (
    policy === undefined ||
    typeof policy === "string" ||
    policy.allow === undefined ||
    Array.isArray(policy.allow)
  ) {
    return undefined;
  }

  const parts: string[] = [];
  for (const [domain, rules] of Object.entries(policy.allow)) {
    const names: string[] = [];
    for (const rule of rules) {
      if (!("transform" in rule) || rule.transform === undefined) {
        continue;
      }
      for (const transform of rule.transform) {
        if (transform.headers === undefined) {
          continue;
        }
        names.push(...Object.keys(transform.headers));
      }
    }
    if (names.length > 0) {
      parts.push(`${domain} (${names.join(", ")})`);
    }
  }
  return parts.length === 0 ? undefined : parts.join(", ");
}
