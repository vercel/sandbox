import * as cmd from "cmd-ts";

export const runtimeType = {
  ...cmd.oneOf(["node22", "node24", "python3.13"] as const),
  displayName: "runtime",
};

export const runtime = cmd.option({
  long: "runtime",
  type: runtimeType,
  defaultValue: () => "node24" as const,
  defaultValueIsSerializable: true,
});
