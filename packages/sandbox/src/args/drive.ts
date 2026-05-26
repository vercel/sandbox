import * as cmd from "cmd-ts";
import chalk from "chalk";
import type { SandboxMountMode, SandboxMounts } from "@vercel/sandbox";

export interface DriveMount {
  drive: string;
  path: string;
  mode?: SandboxMountMode;
}

export type DriveMounts = SandboxMounts;

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
    'Drive mount in the format "drive:/path[:read-only|read-write]".',
  async from(input) {
    return parseDriveMount(input);
  },
});

export const driveMounts = cmd.extendType(cmd.array(driveMount), {
  async from(input): Promise<DriveMounts> {
    const mounts: DriveMounts = Object.create(null);

    for (const mount of input) {
      mounts[mount.path] = { drive: mount.drive, mode: mount.mode };
    }

    return mounts;
  },
});

export const mounts = cmd.multioption({
  long: "mount",
  type: driveMounts,
  description:
    'Attach a drive to the sandbox. Format: "drive:/path[:read-only|read-write]".',
});

export const driveMaxSize = cmd.extendType(cmd.number, {
  displayName: "BYTES",
  async from(input) {
    if (!Number.isInteger(input) || input < 1) {
      throw new Error(
        `Invalid max size: ${input}. Must be a positive integer number of bytes.`,
      );
    }
    return input;
  },
});

export function parseDriveMount(input: string): DriveMount {
  const [drive, path, mode, ...rest] = input.split(":");
  const validModes: SandboxMountMode[] = ["read-only", "read-write"];

  if (rest.length > 0 || !drive || path === undefined) {
    throw new Error(
      [
        `Invalid drive mount: ${input}.`,
        `${chalk.bold("hint:")} Use "drive:/path" or "drive:/path:read-only".`,
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
    mode: mode as SandboxMountMode | undefined,
  };
}
