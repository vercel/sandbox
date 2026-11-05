import type { GithubApiAction } from "./managed-credentials-config";

export const GITHUB_ACCESS_LEVELS = ["read", "write"] as const;
export type GithubAccess = (typeof GITHUB_ACCESS_LEVELS)[number];

/** Fixed sets: adding SDK actions must not silently widen an existing preset. */
export const GITHUB_ACCESS_PRESETS = {
  read: {
    gitAction: "git:read",
    apiActions: [
      "github:pull-request:get",
      "github:issues:read",
      "github:labels:read",
      "github:ci-status:read",
    ],
  },
  write: {
    gitAction: "git:write",
    apiActions: [
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
    ],
  },
} as const satisfies Record<
  GithubAccess,
  {
    gitAction: "git:read" | "git:write";
    apiActions: readonly GithubApiAction[];
  }
>;
