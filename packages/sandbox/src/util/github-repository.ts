import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isGithubRepository } from "../args/credentials";

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

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Reads the Git config of the repository that contains the directory. In a
 * linked worktree or a submodule, `.git` is a file that points at the real Git
 * directory, and a worktree shares the config of its main repository.
 */
async function readGitConfig(directory: string): Promise<string | undefined> {
  let current = resolve(directory);
  for (;;) {
    const dotGit = join(current, ".git");
    const kind = await stat(dotGit).then(
      (stats) => (stats.isDirectory() ? "directory" : "file"),
      () => undefined,
    );
    if (kind === "directory") {
      return readText(join(dotGit, "config"));
    }
    if (kind === "file") {
      const pointer = /^gitdir: (.+)$/m.exec((await readText(dotGit)) ?? "");
      if (!pointer) {
        return undefined;
      }
      const gitDirectory = resolve(current, pointer[1].trim());
      const common = (await readText(join(gitDirectory, "commondir")))?.trim();
      return readText(
        join(common ? resolve(gitDirectory, common) : gitDirectory, "config"),
      );
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Lists the URL of each remote in a Git config, in file order.
 */
function remoteUrls(config: string): Map<string, string> {
  const urls = new Map<string, string>();
  let remote: string | undefined;
  for (const line of config.split(/\r?\n/).map((raw) => raw.trim())) {
    const section = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"([^"]*)")?\s*\]/.exec(line);
    if (section) {
      remote = section[1].toLowerCase() === "remote" ? section[2] : undefined;
      continue;
    }
    const url = /^url\s*=\s*(.*)$/i.exec(line);
    if (url && remote !== undefined && !urls.has(remote)) {
      urls.set(
        remote,
        url[1].replace(/\s+[#;].*$/, "").replace(/^"(.*)"$/, "$1"),
      );
    }
  }
  return urls;
}

/**
 * Finds the GitHub repository that the directory is a clone of: the origin
 * remote when it is on GitHub, otherwise the one repository that every other
 * GitHub remote names. Remotes that name different repositories are not a
 * basis for a choice, so they find nothing, as does a directory outside a Git
 * repository.
 *
 * This reads the Git config file and never runs Git. The directory can be a
 * checkout that nobody has reviewed, and running a program by name there can
 * execute a file that the checkout supplies.
 */
export async function inferGithubRepository(
  cwd = process.cwd(),
): Promise<string | undefined> {
  const config = await readGitConfig(cwd);
  if (config === undefined) {
    return undefined;
  }

  const repositories = new Map<string, string>();
  for (const [remote, url] of remoteUrls(config)) {
    const repository = repositoryFromRemote(url);
    if (repository) {
      repositories.set(remote, repository);
    }
  }
  const origin = repositories.get("origin");
  if (origin !== undefined) {
    return origin;
  }
  const distinct = [...new Set(repositories.values())];
  return distinct.length === 1 ? distinct[0] : undefined;
}
