import chalk from "chalk";
import type { NetworkPolicy, NetworkPolicyRule } from "@vercel/sandbox";
import type { NetworkPolicyArgs, RequestHeader } from "../args/network-policy";

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
          "Cannot combine --network-policy=allow-all with --request-header or --request-header-from-env.",
          "To set request headers and keep every other domain allowed, replace --network-policy=allow-all with --allowed-domain '*'.",
        );
      case "deny-all":
        fail(
          "Cannot combine --network-policy=deny-all with --request-header or --request-header-from-env.",
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

  const byDomain = new Map<string, RequestHeader[]>();
  for (const header of requestHeaders) {
    const headers = byDomain.get(header.domain) ?? [];
    const clash = headers.find(
      (other) => other.name === header.name && methodsOverlap(other, header),
    );
    if (clash) {
      fail(
        `Duplicate request header "${header.name}" for ${header.domain}.`,
        clash.methods === undefined && header.methods === undefined
          ? "Pass each header once per domain. Header names are case-insensitive."
          : "Limit each copy of a header to methods the other copies do not list. A header without [method=...] applies to every method.",
      );
    }
    headers.push(header);
    byDomain.set(header.domain, headers);
  }

  const allow: Record<string, NetworkPolicyRule[]> = Object.create(null);
  for (const [domain, headers] of byDomain) {
    allow[domain] = domainRules(headers);
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

function methodsOverlap(a: RequestHeader, b: RequestHeader): boolean {
  return (
    a.methods === undefined ||
    b.methods === undefined ||
    a.methods.some((method) => b.methods?.includes(method))
  );
}

function headerRecord(headers: RequestHeader[]): Record<string, string> {
  // Null prototype so a token such as `__proto__` stays an own key.
  const record = Object.create(null) as Record<string, string>;
  for (const header of headers) {
    record[header.name] = header.value.reveal();
  }
  return record;
}

/**
 * The proxy applies only the first rule that matches a request, and a rule
 * without `match` matches every request. So each method rule carries the
 * unlimited headers too, methods that get the same headers share one rule, and
 * the unlimited rule comes last.
 */
function domainRules(headers: RequestHeader[]): NetworkPolicyRule[] {
  const byMethods = new Map<
    string,
    { methods: string[]; headers: RequestHeader[] }
  >();
  const methods = [
    ...new Set(headers.flatMap((header) => header.methods ?? [])),
  ];
  for (const method of methods) {
    const applied = headers.filter(
      (header) =>
        header.methods === undefined || header.methods.includes(method),
    );
    const key = applied.map((header) => headers.indexOf(header)).join(",");
    const group = byMethods.get(key);
    if (group) {
      group.methods.push(method);
    } else {
      byMethods.set(key, { methods: [method], headers: applied });
    }
  }

  const rules: NetworkPolicyRule[] = [...byMethods.values()].map((group) => ({
    match: { method: group.methods },
    transform: [{ headers: headerRecord(group.headers) }],
  }));
  const unlimited = headers.filter((header) => header.methods === undefined);
  if (unlimited.length > 0) {
    rules.push({ transform: [{ headers: headerRecord(unlimited) }] });
  }
  return rules;
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
    // A name maps to its methods, or to `undefined` when it is not limited.
    const names = new Map<string, string[] | undefined>();
    for (const rule of rules) {
      if (!("transform" in rule) || rule.transform === undefined) {
        continue;
      }
      const methods = rule.match?.method;
      for (const transform of rule.transform) {
        for (const name of Object.keys(transform.headers ?? {})) {
          const known = names.get(name);
          if (
            methods === undefined ||
            (names.has(name) && known === undefined)
          ) {
            names.set(name, undefined);
          } else {
            names.set(name, [...new Set([...(known ?? []), ...methods])]);
          }
        }
      }
    }
    if (names.size > 0) {
      const labels = [...names].map(([name, methods]) =>
        methods === undefined ? name : `${name} [${methods.join(",")}]`,
      );
      parts.push(`${domain} (${labels.join(", ")})`);
    }
  }
  return parts.length === 0 ? undefined : parts.join(", ");
}
