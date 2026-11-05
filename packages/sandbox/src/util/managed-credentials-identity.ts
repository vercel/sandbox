export interface CommitIdentity {
  name: string;
  email: string;
}
export type IdentitySource =
  | "explicit"
  | "git-config"
  | "gh"
  | "vercel-account-link";
export interface InferredActor {
  actAs: string;
  login?: string;
  source: IdentitySource;
  /** Profile metadata, never a credential. */
  profile?: { name?: string; email?: string; id?: string; login?: string };
}
