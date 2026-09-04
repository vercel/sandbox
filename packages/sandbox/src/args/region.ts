import * as cmd from "cmd-ts";
import { DEFAULT_SANDBOX_REGION } from "@vercel/sandbox";

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
  description: `Region to create the sandbox in (defaults to ${DEFAULT_SANDBOX_REGION}; any Vercel region is supported, e.g. sfo1, fra1, hnd1, syd1)`,
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

export const failoverRegionListType = cmd.extendType(cmd.string, {
  displayName: "REGION,...|none",
  async from(value) {
    if (value.trim() === "none") {
      return [];
    }
    const regions = await regionListType.from(value);
    if (regions.includes("none")) {
      throw new Error('"none" cannot be combined with region names.');
    }
    return regions;
  },
});

export const failoverRegions = cmd.option({
  long: "failover-regions",
  type: cmd.optional(failoverRegionListType),
  description:
    'Comma-separated regions the sandbox can fail over to (e.g. --failover-regions sfo1,fra1). Must not include the sandbox region. Pass "none" for no failover regions, overriding the project default.',
});
