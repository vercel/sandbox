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

export const networkPolicyArgs = {
  networkPolicy,
  allowedDomains,
  allowedCIDRs,
  deniedCIDRs,
} as const;
