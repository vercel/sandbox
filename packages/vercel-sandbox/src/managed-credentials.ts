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

/**
 * Git access levels requested for a managed Sandbox source.
 *
 * Managed Git access is requested through the source rather than through a
 * credential group's `actions`: the transport keeps repository cloning and
 * GitHub API forwarding on separate paths.
 *
 * @hidden
 */
export const MANAGED_GIT_ACTIONS = ["git:read", "git:write"] as const;

/** @hidden */
export type ManagedGitAction = (typeof MANAGED_GIT_ACTIONS)[number];

/**
 * Managed Git credentials requested for a Sandbox source. `true` requests
 * write access, which signed pushes need alongside `commitAs`. `"read"`
 * requests a read-only clone, where `commitAs` metadata has no effect and
 * must not be treated as an upgrade to write access.
 *
 * @hidden
 */
export type ManagedSourceCredentials = true | "read";

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
