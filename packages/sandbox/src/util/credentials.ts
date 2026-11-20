import type { SandboxCredentials } from "@vercel/sandbox";
import {
  DEFAULT_GITHUB_ACTIONS,
  type CredentialsArgs,
} from "../args/credentials";
import { fail } from "./fail";
import { inferGithubRepository } from "./github-repository";

export interface CredentialsRequest {
  credentials?: SandboxCredentials;
  /** The repository to clone, when the options name a single repository. */
  source?: { type: "git"; url: string };
  /**
   * The credentials options that state this request in full, present when
   * the repository or the actions were filled in for the caller.
   */
  explicitOptions?: string[];
}

/**
 * Turns the credentials options into the creation request fields they stand
 * for. A request for nothing leaves every field absent.
 *
 * `github` in --credentials asks for the defaults, and the
 * --credentials-github-* options ask for stated values, so giving both is an
 * error rather than a merge.
 */
export async function buildCredentials(
  args: CredentialsArgs,
  inferRepository: () => Promise<string | undefined> = inferGithubRepository,
): Promise<CredentialsRequest> {
  const {
    credentials: providers,
    credentialsGithubRepository,
    credentialsGithubActions: actions,
    credentialsGithubActAs: actAs,
    credentialsFile,
  } = args;
  const githubOptions = [
    credentialsGithubRepository !== undefined &&
      "--credentials-github-repository",
    actions !== undefined && "--credentials-github-actions",
    actAs !== undefined && "--credentials-github-act-as",
  ].filter((option) => option !== false);

  if (credentialsFile !== undefined) {
    if (providers !== undefined || githubOptions.length > 0) {
      fail(
        "Cannot combine --credentials-file with other credentials options.",
        "Put the whole request in the file. It replaces --credentials, --credentials-github-repository, --credentials-github-actions, and --credentials-github-act-as.",
      );
    }
    return { credentials: credentialsFile };
  }

  const npm = providers?.includes("npm") ? { npm: true as const } : undefined;
  const githubDefaults = providers?.includes("github") ?? false;

  if (githubDefaults && githubOptions.length > 0) {
    fail(
      `Cannot combine --credentials=github with ${githubOptions.join(", ")}.`,
      "github in --credentials requests the default GitHub access. To choose the repository, actions, or account yourself, remove github from --credentials and keep the --credentials-github-* options.",
    );
  }
  if (!githubDefaults && githubOptions.length === 0) {
    return npm ? { credentials: npm } : {};
  }

  const repository = credentialsGithubRepository ?? (await inferRepository());
  if (repository === undefined) {
    fail(
      "Cannot find a GitHub repository in the current directory.",
      `Run the command inside a clone of a github.com repository, or ${githubDefaults ? "replace github in --credentials with" : "add"} --credentials-github-repository OWNER/REPOSITORY.`,
    );
  }
  const grant = {
    repositories: [repository],
    actions: actions ?? [...DEFAULT_GITHUB_ACTIONS],
    ...(actAs !== undefined && { actAs }),
  };

  return {
    credentials: { ...npm, github: [grant] },
    source: { type: "git", url: `https://github.com/${repository}.git` },
    ...((credentialsGithubRepository === undefined ||
      actions === undefined) && {
      explicitOptions: [
        ...(npm ? ["--credentials=npm"] : []),
        `--credentials-github-repository=${repository}`,
        `--credentials-github-actions=${grant.actions.join(",")}`,
        ...(actAs !== undefined
          ? [`--credentials-github-act-as=${actAs}`]
          : []),
      ],
    }),
  };
}
