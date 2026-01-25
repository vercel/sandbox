import * as cmd from "cmd-ts";
import chalk from "chalk";

export const snapshotId = cmd.extendType(cmd.string, {
  displayName: "snapshot_id",
  description: "The ID of the snapshot",
  async from(s) {
    if (!s.startsWith("snap_")) {
      throw new Error(
        [
          `Malformed snapshot ID: "${s}".`,
          `${chalk.bold("hint:")} Snapshot IDs must start with 'snap_' (e.g., snap_abc123def456).`,
        ].join("\n"),
      );
    }
    return s;
  },
});
