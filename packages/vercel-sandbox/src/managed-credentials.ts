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

/** @hidden */
export interface ManagedCredentialOptions {
  /** @hidden */
  commitAs?: { name: string; email: string };
  /** @hidden */
  credentials?: {
    github: {
      repositories: string[];
      actions: (typeof GITHUB_API_CREDENTIAL_ACTIONS)[number][];
      actAs?: string;
    }[];
  };
}
