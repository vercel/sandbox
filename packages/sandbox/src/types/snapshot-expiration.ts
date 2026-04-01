import { extendType, string } from "cmd-ts";
import { Duration } from "./duration";
import type { StringValue } from "ms";

export const SnapshotExpiration = extendType(string, {
  displayName: "DURATION|none",
  description: 'A duration (e.g. 7d, 30d) or "none" for no expiration',
  async from(value): Promise<StringValue> {
    if (value === "none") {
      return "0";
    }
    return Duration.from(value);
  },
});
