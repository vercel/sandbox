import { extendType, string } from "cmd-ts";
import type { StringValue } from "ms";
import chalk from "chalk";

export const Duration = extendType(string, {
  displayName: "num UNIT",
  description: "A duration, e.g. 5m, 10s, 1h",
  async from(string): Promise<StringValue> {
    const match = string.match(
      /^(\d+) ?(ms|milliseconds?|msecs?|s(?:econds?)?|m(?:inutes?)?|h(?:ours?)?|d(?:ays?)?)?$/,
    );

    if (!match) {
      throw new Error(
        [
          `Malformed duration: "${string}".`,
          `${chalk.bold("hint:")} Use a number followed by a unit: s (seconds), m (minutes), h (hours), d (days).`,
          "╰▶ Examples: 30s, 5m, 2h, 1d",
        ].join("\n"),
      );
    }

    return match[0] as unknown as StringValue;
  },
});
