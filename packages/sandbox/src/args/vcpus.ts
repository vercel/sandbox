import * as cmd from "cmd-ts";

export const vcpusType = cmd.extendType(cmd.number, {
  displayName: "COUNT",
  async from(n) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `Invalid vCPU count: ${n}. Must be a positive integer.`,
      );
    }
    return n;
  },
});

export const vcpus = cmd.option({
  long: "vcpus",
  type: cmd.optional(vcpusType),
  description:
    "Number of vCPUs to allocate (each vCPU includes 2048 MB of memory)",
});
