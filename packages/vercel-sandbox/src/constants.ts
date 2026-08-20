export type RUNTIMES = "node26" | "node24" | "node22" | "python3.13";

export type ManagedImage =
  | "universal"
  | "node:22"
  | "node:24"
  | "node:26"
  | "python:3.14"
  | "ubuntu"
  | "arch";

/**
 * Regions a sandbox, snapshot, or drive can live in. More regions may
 * become available, so any other region string is accepted too.
 */
export type SandboxRegion = "iad1" | "sfo1" | "cle1" | "cdg1" | (string & {});
