import chalk from "chalk";
import type { NetworkPolicy } from "@vercel/sandbox";

type NetworkPolicyMode = "internet-access" | "no-access" | "restricted";

/**
 * Builds a NetworkPolicy from CLI arguments (optional mode for create).
 */
export function buildNetworkPolicy(args: {
  networkPolicy?: NetworkPolicyMode;
  allowedDomains: string[];
  allowedCIDRs: string[];
  deniedCIDRs: string[];
}): NetworkPolicy {
  const { networkPolicy, allowedDomains, allowedCIDRs, deniedCIDRs } = args;

  if (!networkPolicy || networkPolicy !== "restricted") {
    // If any of the list options are provided without restricted mode, throw an error
    if (
      allowedDomains.length > 0 ||
      allowedCIDRs.length > 0 ||
      deniedCIDRs.length > 0
    ) {
      throw new Error(
        [
          "Network policy options require --network-policy to be set to restricted.",
          `${chalk.bold("hint:")} Use --network-policy=restricted to allow/deny specific domains or CIDRs.`,
        ].join("\n"),
      );
    }
  }

  switch (networkPolicy) {
    // If no network policy mode specified, return undefined (use default)
    case undefined:
    case "internet-access":
      return { type: "internet-access" };
    case "no-access":
      return { type: "no-access" };
    case "restricted":
      return {
        type: "restricted",
        allowedDomains:
          allowedDomains.length > 0 ? allowedDomains : undefined,
        allowedCIDRs: allowedCIDRs.length > 0 ? allowedCIDRs : undefined,
        deniedCIDRs: deniedCIDRs.length > 0 ? deniedCIDRs : undefined,
      };
  }
}
