export interface CommitIdentity {
  name: string;
  email: string;
}
export type IdentitySource = "explicit" | "gh" | "vercel-account-link";
export interface InferredActor {
  actAs: string;
  login?: string;
  source: IdentitySource;
}
