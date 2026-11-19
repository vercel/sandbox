import type { SandboxCredentials } from "@vercel/sandbox";
import {
  DEFAULT_GITHUB_ACTIONS,
  type CredentialsArgs,
} from "../args/credentials";
import { fail } from "./fail";

export interface CredentialsRequest {
  credentials?: SandboxCredentials;
  /** The repository to clone, when one option names a single repository. */
  source?: { type: "git"; url: string };
}

/**
 * Turns the credentials options into the creation request fields they stand
 * for. A request for nothing leaves both fields absent.
 */
export function buildCredentials(args: CredentialsArgs): CredentialsRequest {
  const {
    credentials: providers,
    credentialsGithubRepository: repository,
    credentialsGithubActions: actions,
    credentialsGithubActAs: actAs,
    credentialsFile,
  } = args;

  if (credentialsFile !== undefined) {
    if (
      providers !== undefined ||
      repository !== undefined ||
      actions !== undefined ||
      actAs !== undefined
    ) {
      fail(
        "Cannot combine --credentials-file with other credentials options.",
        "Put the whole request in the file. It replaces --credentials, --credentials-github-repository, --credentials-github-actions, and --credentials-github-act-as.",
      );
    }
    return { credentials: credentialsFile };
  }

  const npm = providers?.includes("npm") ? { npm: true as const } : undefined;

  if (repository === undefined) {
    const orphan =
      actions !== undefined
        ? "--credentials-github-actions"
        : actAs !== undefined
          ? "--credentials-github-act-as"
          : undefined;
    if (orphan !== undefined) {
      fail(
        `${orphan} needs a repository.`,
        "Add --credentials-github-repository OWNER/REPOSITORY.",
      );
    }
    return npm ? { credentials: npm } : {};
  }

  return {
    credentials: {
      ...npm,
      github: [
        {
          repositories: [repository],
          actions: actions ?? [...DEFAULT_GITHUB_ACTIONS],
          ...(actAs !== undefined && { actAs }),
        },
      ],
    },
    source: { type: "git", url: `https://github.com/${repository}.git` },
  };
}
