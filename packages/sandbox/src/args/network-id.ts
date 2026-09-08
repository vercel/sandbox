import * as cmd from "cmd-ts";

export const networkIdType = cmd.extendType(cmd.string, {
  displayName: "NETWORK_ID",
  async from(value) {
    const networkId = value.trim();
    if (networkId === "") {
      throw new Error("Network ID cannot be empty.");
    }
    if (networkId.length > 255) {
      throw new Error("Network ID cannot exceed 255 characters.");
    }
    return networkId;
  },
});

export const networkIdOrNoneType = cmd.extendType(cmd.string, {
  displayName: "NETWORK_ID|none",
  async from(value) {
    return value.trim() === "none" ? null : networkIdType.from(value);
  },
});

export const networkId = cmd.option({
  long: "network-id",
  type: cmd.optional(networkIdType),
  description:
    "Connect network ID for the target Secure Compute private network",
});
