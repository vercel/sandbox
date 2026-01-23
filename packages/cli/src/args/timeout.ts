import { Duration } from "../types/duration";
import * as cmd from "cmd-ts";

export const timeout = cmd.option({
  long: "timeout",
  type: Duration,
  description: "The maximum duration a sandbox can run for. Example: 5m, 1h",
  defaultValue: () => "5 minutes" as const,
  defaultValueIsSerializable: true,
});
