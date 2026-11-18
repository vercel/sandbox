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

/**
 * Git and GitHub API actions a sandbox can be granted through
 * `credentials.github`.
 *
 * @experimental
 */
export const SANDBOX_GITHUB_CREDENTIAL_ACTIONS = [
  "git:read",
  "git:write",
  "git:write-workflows",
  "git:force-push",
  "github:pull-request:create",
  "github:pull-request:get",
  "github:pull-request:update",
  "github:pull-request:comment",
  "github:issues:read",
  "github:issues:create",
  "github:issues:update",
  "github:issues:comment",
  "github:labels:read",
  "github:labels:write",
  "github:ci-status:read",
  "github:repository:read",
  "github:repository-permissions:read",
] as const;

/**
 * One of the {@link SANDBOX_GITHUB_CREDENTIAL_ACTIONS}.
 *
 * @experimental
 */
export type SandboxGitHubCredentialAction =
  (typeof SANDBOX_GITHUB_CREDENTIAL_ACTIONS)[number];
