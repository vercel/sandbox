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
 * Region a sandbox runs in when none is requested.
 */
export const DEFAULT_SANDBOX_REGION = "iad1";
