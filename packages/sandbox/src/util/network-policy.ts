import chalk from "chalk";
import type { NetworkPolicy } from "@vercel/sandbox";

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

/**
 * Builds a NetworkPolicy from CLI arguments.
 */
export function buildNetworkPolicy(args: {
  networkPolicy?: NetworkPolicyMode;
  allowedDomains: string[];
  allowedCIDRs: string[];
  deniedCIDRs: string[];
}): NetworkPolicy {
  const { networkPolicy, allowedDomains, allowedCIDRs, deniedCIDRs } = args;

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

  if (hasListOptions) {
    return {
      ...(allowedDomains.length > 0 && { allow: allowedDomains }),
      ...((allowedCIDRs.length > 0 || deniedCIDRs.length > 0) && {
        subnets: {
          ...(allowedCIDRs.length > 0 && { allow: allowedCIDRs }),
          ...(deniedCIDRs.length > 0 && { deny: deniedCIDRs }),
        },
      }),
    };
  }

  return networkPolicy ?? "allow-all";
}
