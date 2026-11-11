/**
 * Regions a sandbox, snapshot, or drive can live in. More regions may
 * become available, so any other region string is accepted too.
 */
export type DriveRegion =
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
export const DEFAULT_DRIVE_REGION = "iad1";
