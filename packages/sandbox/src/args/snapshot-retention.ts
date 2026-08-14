import * as cmd from "cmd-ts";
import { SnapshotExpiration } from "../types/snapshot-expiration";

export const snapshotExpiration = cmd.option({
  long: "snapshot-expiration",
  type: cmd.optional(SnapshotExpiration),
  description:
    'Default snapshot expiration (7d when omitted). Use "none" or 0 for no expiration. Example: 7d, 30d',
});

export const keepLastSnapshots = cmd.option({
  long: "keep-last-snapshots",
  type: cmd.optional(
    cmd.extendType(cmd.number, {
      displayName: "COUNT",
      async from(n) {
        if (!Number.isInteger(n) || n < 0 || n > 10) {
          throw new Error(
            `Invalid --keep-last-snapshots value: ${n}. Must be an integer between 0 and 10.`,
          );
        }
        return n;
      },
    }),
  ),
  description:
    "Keep only the N most recent snapshots of this sandbox (1-10). Persistent sandboxes keep 1 by default; pass 0 to keep every snapshot until it expires.",
});

export const keepLastSnapshotsFor = cmd.option({
  long: "keep-last-snapshots-for",
  type: cmd.optional(SnapshotExpiration),
  description:
    'Expiration applied to kept snapshots (7d when omitted). Use "none" or 0 for no expiration. Example: 7d, 30d',
});

export const deleteEvictedSnapshots = cmd.option({
  long: "delete-evicted-snapshots",
  type: cmd.optional({
    ...cmd.oneOf(["true", "false"]),
    displayName: "true|false",
  }),
  description:
    'When "true" (the default), evicted snapshots are deleted immediately; when "false", they keep the default expiration.',
});

export const snapshotRetentionArgs = {
  snapshotExpiration,
  keepLastSnapshots,
  keepLastSnapshotsFor,
  deleteEvictedSnapshots,
} as const;
