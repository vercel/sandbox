import * as cmd from "cmd-ts";

export const runtime = cmd.option({
  long: "runtime",
  type: {
    ...cmd.oneOf(["node22", "node24", "python3.13"] as const),
    displayName: "runtime",
  },
  defaultValue: () => "node24" as const,
  defaultValueIsSerializable: true,
});
