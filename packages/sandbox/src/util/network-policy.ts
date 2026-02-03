import chalk from "chalk";
import type { NetworkPolicy } from "@vercel/sandbox";

type NetworkPolicyMode = "allow-all" | "deny-all" | "custom";

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

  if (!networkPolicy || networkPolicy !== "custom") {
    // If any of the list options are provided without custom mode, throw an error
    if (
      allowedDomains.length > 0 ||
      allowedCIDRs.length > 0 ||
      deniedCIDRs.length > 0
    ) {
      throw new Error(
        [
          "Network policy options require --network-policy to be set to custom.",
          `${chalk.bold("hint:")} Use --network-policy=custom to allow/deny specific domains or CIDRs.`,
        ].join("\n"),
      );
    }
  }

  switch (networkPolicy) {
    // If no network policy mode specified, return undefined (use default)
    case undefined:
    case "allow-all":
      return { mode: "allow-all" };
    case "deny-all":
      return { mode: "deny-all" };
    case "custom":
      return {
        mode: "custom",
        allowedDomains:
          allowedDomains.length > 0 ? allowedDomains : undefined,
        allowedCIDRs: allowedCIDRs.length > 0 ? allowedCIDRs : undefined,
        deniedCIDRs: deniedCIDRs.length > 0 ? deniedCIDRs : undefined,
      };
  }
}
