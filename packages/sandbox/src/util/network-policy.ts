import chalk from "chalk";
import type { NetworkPolicy, InjectionRule } from "@vercel/sandbox";

type NetworkPolicyMode = "internet-access" | "no-access" | "restricted";

/**
 * Builds a NetworkPolicy from CLI arguments (optional mode for create).
 */
export function buildNetworkPolicy(args: {
  networkPolicy?: NetworkPolicyMode;
  allowedDomains: string[];
  allowedCIDRs: string[];
  deniedCIDRs: string[];
  injectionRules: InjectionRule[];
}): NetworkPolicy {
  const {
    networkPolicy,
    allowedDomains,
    allowedCIDRs,
    deniedCIDRs,
    injectionRules,
  } = args;

  if (!networkPolicy || networkPolicy !== "restricted") {
    // If any of the allow/deny list options are provided without restricted mode, throw an error
    // Note: injectionRules are allowed with any mode
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

  const rules = injectionRules.length > 0 ? injectionRules : undefined;

  switch (networkPolicy) {
    // If no network policy mode specified, return undefined (use default)
    case undefined:
    case "internet-access":
      return { type: "internet-access", injectionRules: rules };
    case "no-access":
      return { type: "no-access", injectionRules: rules };
    case "restricted":
      return {
        type: "restricted",
        allowedDomains:
          allowedDomains.length > 0 ? allowedDomains : undefined,
        allowedCIDRs: allowedCIDRs.length > 0 ? allowedCIDRs : undefined,
        deniedCIDRs: deniedCIDRs.length > 0 ? deniedCIDRs : undefined,
        injectionRules: rules,
      };
  }
}
