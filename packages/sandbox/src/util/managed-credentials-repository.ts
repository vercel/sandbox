import { isRepository, repositoryFromUrl } from "./managed-credentials-config";
import { readCommand, GIT_TIMEOUT_MS } from "./managed-credentials-command";

/** Only github.com HTTPS and SSH remotes identify a supported repository. */
export function repositoryFromRemote(value: string): string | undefined {
  const https = repositoryFromUrl(value);
  if (https) return https;
  const ssh =
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(
      value,
    );
  if (!ssh) return undefined;
  const repo = `${ssh[1]}/${ssh[2]}`;
  return isRepository(repo) ? repo : undefined;
}

/** Prefer origin, then the first supported fetch remote. Never enables access. */
export async function inferRepository(
  cwd = process.cwd(),
): Promise<string | undefined> {
  if (
    (await readCommand(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      GIT_TIMEOUT_MS,
      cwd,
    )) !== "true"
  )
    return undefined;
  const remotes = await readCommand(
    "git",
    ["remote", "-v"],
    GIT_TIMEOUT_MS,
    cwd,
  );
  if (!remotes) return undefined;
  const parsed = new Map<string, string>();
  for (const line of remotes.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (!match) continue;
    const repo = repositoryFromRemote(match[2]);
    if (repo && !parsed.has(match[1])) parsed.set(match[1], repo);
  }
  return parsed.get("origin") ?? [...parsed.values()][0];
}
