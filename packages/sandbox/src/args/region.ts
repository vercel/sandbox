import * as cmd from "cmd-ts";

/**
 * Region a sandbox runs in when the API does not report one.
 */
export const DEFAULT_SANDBOX_REGION = "iad1";

export const regionType = cmd.extendType(cmd.string, {
  displayName: "REGION",
  async from(value) {
    const region = value.trim();
    if (region === "") {
      throw new Error("Region cannot be empty.");
    }
    return region;
  },
});

export const region = cmd.option({
  long: "region",
  type: cmd.optional(regionType),
  description: `Region to create the sandbox in (defaults to ${DEFAULT_SANDBOX_REGION}; see the Vercel docs for available regions)`,
});

export const regionListType = cmd.extendType(cmd.string, {
  displayName: "REGION,...",
  async from(value) {
    const regions = value
      .split(",")
      .map((region) => region.trim())
      .filter((region) => region !== "");
    if (regions.length === 0) {
      throw new Error("Regions cannot be empty.");
    }
    return [...new Set(regions)];
  },
});

export const failoverRegions = cmd.option({
  long: "failover-regions",
  type: cmd.optional(regionListType),
  description:
    "Comma-separated regions the sandbox can fail over to (e.g. --failover-regions sfo1,cle1). Must not include the sandbox region.",
});
