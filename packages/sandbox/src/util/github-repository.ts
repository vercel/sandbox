import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isGithubRepository } from "../args/credentials";

const GIT_TIMEOUT_MS = 5_000;

/**
 * Reads OWNER/REPOSITORY from a Git remote URL. Only github.com HTTPS and SSH
 * remotes name a repository that managed credentials support.
 */
export function repositoryFromRemote(remote: string): string | undefined {
  const match =
    /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?$/i.exec(
      remote,
    ) ??
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(
      remote,
    );
  if (!match) {
    return undefined;
  }
  const repository = `${match[1]}/${match[2]}`;
  return isGithubRepository(repository) ? repository : undefined;
}

/**
 * Finds the GitHub repository that the directory is a clone of: the origin
 * remote when it is on GitHub, otherwise the one repository that every other
 * GitHub remote names. Remotes that name different repositories are not a
 * basis for a choice, so they find nothing, as does a directory outside a Git
 * repository or a machine without Git.
 */
export async function inferGithubRepository(
  cwd = process.cwd(),
): Promise<string | undefined> {
  let remotes: string;
  try {
    ({ stdout: remotes } = await promisify(execFile)("git", ["remote", "-v"], {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
    }));
  } catch {
    return undefined;
  }

  const repositories = new Map<string, string>();
  for (const line of remotes.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line.trim());
    const repository = match && repositoryFromRemote(match[2]);
    if (match && repository && !repositories.has(match[1])) {
      repositories.set(match[1], repository);
    }
  }
  const origin = repositories.get("origin");
  if (origin !== undefined) {
    return origin;
  }
  const distinct = [...new Set(repositories.values())];
  return distinct.length === 1 ? distinct[0] : undefined;
}
