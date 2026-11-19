import * as cmd from "cmd-ts";

export const architectureType = {
  ...cmd.oneOf(["amd64", "arm64"] as const),
  displayName: "ARCHITECTURE",
};

export const architecture = cmd.option({
  long: "architecture",
  type: cmd.optional(architectureType),
  description: "CPU architecture of the sandbox: amd64 or arm64.",
});
