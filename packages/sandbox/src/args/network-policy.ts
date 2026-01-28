import * as cmd from "cmd-ts";
import chalk from "chalk";

const networkPolicyMode = cmd.extendType(cmd.string, {
  displayName: "MODE",
  async from(value) {
    const validModes = ["internet-access", "no-access", "restricted"];
    if (!validModes.includes(value)) {
      throw new Error(
        [
          `Invalid network policy mode: ${value}.`,
          `${chalk.bold("hint:")} Valid modes are: ${validModes.join(", ")}`,
        ].join("\n"),
      );
    }
    return value as "internet-access" | "no-access" | "restricted";
  },
});

export const networkPolicy = cmd.option({
  long: "network-policy",
  description:
    `Network policy mode: "internet-access", "no-access", or "restricted"
    
internet-access: sandbox can access any website/domain
no-access: sandbox has no network access
restricted: sandbox can only access websites and domains explicitly allowed`,
  type: cmd.optional(networkPolicyMode),
});

export const allowedDomains = cmd.multioption({
  long: "allowed-domain",
  description:
    `Domain to allow traffic to (requires --network-policy=restricted)

Supports "*" for wildcards for a segment (e.g. '*.vercel.com', 'www.*.com')
If used as the first segment, will match any subdomain.`,
  type: cmd.array(cmd.string),
});

export const allowedCIDRs = cmd.multioption({
  long: "allowed-cidr",
  description:
    `CIDR to allow traffic to (requires --network-policy=restricted)

Takes precedence over 'allowed-domain'.
`,
  type: cmd.array(cmd.string),
});

export const deniedCIDRs = cmd.multioption({
  long: "denied-cidr",
  description:
    `CIDR to deny traffic to (requires --network-policy=restricted)

Takes precedence over allowed domains/CIDRs.`,
  type: cmd.array(cmd.string),
});

export type InjectionRule = {
  domain: string;
  headers: Record<string, string>;
};

const injectionRuleType = cmd.extendType(cmd.string, {
  displayName: "JSON",
  async from(value) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as InjectionRule).domain !== "string" ||
        typeof (parsed as InjectionRule).headers !== "object" ||
        (parsed as InjectionRule).headers === null
      ) {
        throw new Error("Invalid structure");
      }
      return parsed as InjectionRule;
    } catch {
      throw new Error(
        [
          `Invalid injection rule JSON: ${value}`,
          `${chalk.bold("hint:")} Format: '{"domain": "*.example.com", "headers": {"Header-Name": "value"}}'`,
        ].join("\n"),
      );
    }
  },
});

export const injectionRules = cmd.multioption({
  long: "injection-rule",
  description:
    `Rule to inject HTTP headers for requests matching a domain (requires --network-policy=restricted)

Format: JSON object with "domain" and "headers" fields.
Example: '{"domain": "*.example.com", "headers": {"Authorization": "Bearer token"}}'

Supports wildcards like *.example.com for domain matching.`,
  type: cmd.array(injectionRuleType),
});

export const networkPolicyArgs = {
  networkPolicy,
  allowedDomains,
  allowedCIDRs,
  deniedCIDRs,
  injectionRules,
} as const;
