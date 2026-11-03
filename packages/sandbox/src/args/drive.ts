import * as cmd from "cmd-ts";
import chalk from "chalk";
import type { SandboxMountMode, Sandbox } from "@vercel/sandbox";

export interface DriveMount {
  drive: string;
  path: string;
  mode?: SandboxMountMode;
}

export type DriveMounts = NonNullable<Sandbox["mounts"]>;

export const driveName = cmd.extendType(cmd.string, {
  displayName: "name",
  description: "The name of the drive",
  async from(input) {
    const value = input.trim();
    if (value.length === 0) {
      throw new Error("Drive name cannot be empty.");
    }
    return value;
  },
});

export const driveMount = cmd.extendType(cmd.string, {
  displayName: "drive:path[:mode]",
  description:
    'Drive mount in the format "drive:/path[:snapshot|read-write]".',
  async from(input) {
    return parseDriveMount(input);
  },
});

export const driveMounts = cmd.extendType(cmd.array(driveMount), {
  async from(input): Promise<DriveMounts> {
    const mounts: DriveMounts = Object.create(null);

    for (const mount of input) {
      mounts[mount.path] = {
        drive: mount.drive,
        mode: mount.mode ?? "read-write",
      };
    }

    return mounts;
  },
});

export const mounts = cmd.multioption({
  long: "mount",
  type: driveMounts,
  description:
    'Attach a drive to the sandbox. Format: "drive:/path[:snapshot|read-write]".',
});

// Binary multipliers. The docs describe drive sizes in GiB and TiB and the
// API takes bytes, so "GB"/"TB" are accepted as aliases of the binary units
// rather than as decimal units that would land 7-10% below what was typed.
const SIZE_MULTIPLIERS: Record<string, number> = {
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
  t: 1024 ** 4,
};

/**
 * Parses a drive size such as "200GiB", "2TiB", "5 GB" or "5368709120".
 * A bare number is bytes. Anything that does not parse throws, so a typo
 * like "2TiB" can never be sent to the API as 2 bytes.
 */
export function parseDriveSize(input: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:([kmgt])(?:i?b)?|b)?\s*$/i.exec(input);
  const invalid = () =>
    new Error(
      `Invalid size "${input}". Use bytes or a size with a unit, e.g. 200GiB or 2TiB.`,
    );
  if (!match) {
    throw invalid();
  }
  const [, amount, unit] = match;
  const bytes = Math.round(
    Number(amount) * (unit ? SIZE_MULTIPLIERS[unit.toLowerCase()] : 1),
  );
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw invalid();
  }
  return bytes;
}

export const driveMaxSize = cmd.extendType(cmd.string, {
  displayName: "SIZE",
  async from(input) {
    return parseDriveSize(input);
  },
});

export const driveRegion = cmd.extendType(cmd.string, {
  displayName: "REGION",
  async from(input) {
    const region = input.trim();
    if (region.length === 0) {
      throw new Error("Drive region cannot be empty.");
    }
    return region;
  },
});

export function parseDriveMount(input: string): DriveMount {
  const [drive, path, mode, ...rest] = input.split(":");
  const validModes: SandboxMountMode[] = ["snapshot", "read-write"];

  if (rest.length > 0 || !drive || path === undefined) {
    throw new Error(
      [
        `Invalid drive mount: ${input}.`,
        `${chalk.bold("hint:")} Use "drive:/path" or "drive:/path:snapshot".`,
      ].join("\n"),
    );
  }

  if (mode !== undefined && !validModes.includes(mode as SandboxMountMode)) {
    throw new Error(
      [
        `Invalid drive mount mode: ${mode}.`,
        `${chalk.bold("hint:")} Valid modes are: ${validModes.join(", ")}`,
      ].join("\n"),
    );
  }

  return {
    drive,
    path,
    mode: mode as DriveMount["mode"],
  };
}
