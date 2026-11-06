/** @hidden */
export const GITHUB_API_CREDENTIAL_ACTIONS = [
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
] as const;

/** Git and GitHub API actions supported by Sandbox creation. @hidden */
export const SANDBOX_GITHUB_CREDENTIAL_ACTIONS = [
  "git:write",
  "git:write-workflows",
  ...GITHUB_API_CREDENTIAL_ACTIONS,
] as const;

/** @hidden */
export type SandboxGithubCredentialAction =
  (typeof SANDBOX_GITHUB_CREDENTIAL_ACTIONS)[number];

/** @hidden */
export interface ManagedCredentialOptions {
  /** @hidden */
  credentials?: {
    github: {
      repositories: string[];
      actions: SandboxGithubCredentialAction[];
      actAs?: string;
    }[];
  };
}
