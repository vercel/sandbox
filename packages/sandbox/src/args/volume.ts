import * as cmd from "cmd-ts";
import chalk from "chalk";
import type { SandboxMountMode, SandboxMounts } from "@vercel/sandbox";

export interface VolumeMount {
  volume: string;
  path: string;
  mode?: SandboxMountMode;
}

export type VolumeMounts = SandboxMounts;

export const volumeName = cmd.extendType(cmd.string, {
  displayName: "name",
  description: "The name of the volume",
  async from(input) {
    const value = input.trim();
    if (value.length === 0) {
      throw new Error("Volume name cannot be empty.");
    }
    return value;
  },
});

export const volumeMount = cmd.extendType(cmd.string, {
  displayName: "volume:path[:mode]",
  description:
    'Volume mount in the format "volume:/path[:read-only|read-write]".',
  async from(input) {
    return parseVolumeMount(input);
  },
});

export const volumeMounts = cmd.extendType(cmd.array(volumeMount), {
  async from(input): Promise<VolumeMounts> {
    const mounts: VolumeMounts = Object.create(null);

    for (const mount of input) {
      mounts[mount.path] = { volume: mount.volume, mode: mount.mode };
    }

    return mounts;
  },
});

export const mounts = cmd.multioption({
  long: "mount",
  type: volumeMounts,
  description:
    'Attach a volume to the sandbox. Format: "volume:/path[:read-only|read-write]".',
});

export const volumeMaxSize = cmd.extendType(cmd.number, {
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

export function parseVolumeMount(input: string): VolumeMount {
  const [volume, path, mode, ...rest] = input.split(":");
  const validModes: SandboxMountMode[] = ["read-only", "read-write"];

  if (rest.length > 0 || !volume || path === undefined) {
    throw new Error(
      [
        `Invalid volume mount: ${input}.`,
        `${chalk.bold("hint:")} Use "volume:/path" or "volume:/path:read-only".`,
      ].join("\n"),
    );
  }

  if (mode !== undefined && !validModes.includes(mode as SandboxMountMode)) {
    throw new Error(
      [
        `Invalid volume mount mode: ${mode}.`,
        `${chalk.bold("hint:")} Valid modes are: ${validModes.join(", ")}`,
      ].join("\n"),
    );
  }

  return {
    volume,
    path,
    mode: mode as SandboxMountMode | undefined,
  };
}
