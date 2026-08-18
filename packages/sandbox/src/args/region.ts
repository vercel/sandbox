import * as cmd from "cmd-ts";

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
  description:
    "Region to create the sandbox in (defaults to iad1; see the Vercel docs for available regions)",
});

export const failoverRegions = cmd.multioption({
  long: "failover-region",
  type: cmd.array(regionType),
  description:
    "Additional region the sandbox can fail over to (repeatable). Must not include the sandbox region.",
});
