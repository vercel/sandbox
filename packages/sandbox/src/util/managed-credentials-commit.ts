import { CliError } from "./cli-error";
import { readCommand, GIT_TIMEOUT_MS } from "./managed-credentials-command";
import type { CommitIdentity } from "./managed-credentials-identity";

/** Effective configuration includes repository-local overrides. */
export async function inferCommitIdentity(
  cwd = process.cwd(),
): Promise<CommitIdentity | undefined> {
  const [name, email] = await Promise.all([
    readCommand("git", ["config", "--get", "user.name"], GIT_TIMEOUT_MS, cwd),
    readCommand("git", ["config", "--get", "user.email"], GIT_TIMEOUT_MS, cwd),
  ]);
  return name && email ? { name, email } : undefined;
}

export function parseCommitAs(value: string): CommitIdentity {
  const match = /^\s*(.+?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(value);
  if (
    !match ||
    !match[1].trim() ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(match[2])
  ) {
    throw new CliError(
      '--credentials-commit-as expects "Name <email@example.com>".',
    );
  }
  return { name: match[1].trim(), email: match[2] };
}

/** Commit credit is metadata, separate from permission and API identity. */
export function commitIdentityFromProfile(profile: {
  githubName?: string;
  githubLogin?: string;
  githubId?: string | number;
  githubEmail?: string;
  vercelName?: string;
  vercelUsername?: string;
  vercelEmail?: string;
}): CommitIdentity | undefined {
  const name =
    profile.githubName ||
    profile.githubLogin ||
    profile.vercelName ||
    profile.vercelUsername;
  const email =
    profile.githubId !== undefined && profile.githubLogin
      ? `${profile.githubId}+${profile.githubLogin}@users.noreply.github.com`
      : profile.githubEmail || profile.vercelEmail;
  return name && email ? { name, email } : undefined;
}
