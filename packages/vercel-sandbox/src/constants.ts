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
 * Regions a sandbox can run in. More regions may become available, so any
 * other region string is accepted too.
 */
export type SandboxRegion =
  | "iad1"
  | "sfo1"
  | "cle1"
  | "cdg1"
  | "fra1"
  | "arn1"
  | "sin1"
  | "pdx1"
  | "lhr1"
  | "icn1"
  | "bom1"
  | "cpt1"
  | "dub1"
  | "gru1"
  | "hkg1"
  | "syd1"
  | "yul1"
  | "hnd1"
  | "kix1"
  | (string & {});

/**
 * Region a sandbox runs in when none is requested.
 */
export const DEFAULT_SANDBOX_REGION = "iad1";
