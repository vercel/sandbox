import ms from "ms";
import chalk from "chalk";

interface KeepLastSnapshotsInput {
  keepLastSnapshots: number | undefined;
  keepLastSnapshotsFor: string | undefined;
  // cmd-ts `oneOf(["true", "false"])` returns `string | undefined`, not the
  // narrower literal type — accept the broader shape here.
  deleteEvictedSnapshots: string | undefined;
}

export interface KeepLastSnapshotsPayload {
  count: number;
  expiration: number | undefined;
  deleteEvicted: boolean | undefined;
}

/**
 * Validates the `--keep-last-snapshots*` flag combination and builds the
 * payload object that the SDK expects, or returns `undefined` when no
 * retention policy was configured.
 *
 * Throws when `--keep-last-snapshots-for` or `--delete-evicted-snapshots` are
 * passed without `--keep-last-snapshots`.
 */
export function buildKeepLastSnapshotsPayload(
  input: KeepLastSnapshotsInput,
): KeepLastSnapshotsPayload | undefined {
  const { keepLastSnapshots, keepLastSnapshotsFor, deleteEvictedSnapshots } =
    input;

  if (
    keepLastSnapshots === undefined &&
    (keepLastSnapshotsFor !== undefined ||
      deleteEvictedSnapshots !== undefined)
  ) {
    throw new Error(
      [
        "--keep-last-snapshots-for and --delete-evicted-snapshots require --keep-last-snapshots.",
        `${chalk.bold("hint:")} Pass --keep-last-snapshots <count> to enable the retention policy.`,
      ].join("\n"),
    );
  }

  if (keepLastSnapshots === undefined) {
    return undefined;
  }

  return {
    count: keepLastSnapshots,
    expiration:
      keepLastSnapshotsFor !== undefined
        ? ms(keepLastSnapshotsFor as Parameters<typeof ms>[0])
        : undefined,
    deleteEvicted:
      deleteEvictedSnapshots !== undefined
        ? deleteEvictedSnapshots === "true"
        : undefined,
  };
}
