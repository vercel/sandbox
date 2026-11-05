import { CliError } from "./cli-error";
import type { CommitIdentity } from "./managed-credentials-identity";

/**
 * Parse explicit `--credentials-github-commit-as` metadata.
 *
 * Commit credit is metadata, separate from permission and API identity. Only
 * an explicit value is accepted: the broker derives normal Git attribution
 * from the selected actor, and local Git configuration never selects identity.
 */
export function parseCommitAs(value: string): CommitIdentity {
  const match = /^\s*(.+?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(value);
  if (
    !match ||
    !match[1].trim() ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(match[2])
  ) {
    throw new CliError(
      '--credentials-github-commit-as expects "Name <email@example.com>".',
    );
  }
  return { name: match[1].trim(), email: match[2] };
}
