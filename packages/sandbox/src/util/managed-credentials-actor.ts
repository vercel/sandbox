import { githubActor } from "./managed-credentials-config";
import { CliError } from "./cli-error";
import { readGhAccount } from "./managed-credentials-gh";
import { readVercelGithubLink } from "./managed-credentials-vercel";
import type { InferredActor } from "./managed-credentials-identity";

/** Explicit > gh > Vercel. A failed lookup never means permission to substitute. */
export async function inferActor(options: {
  explicit?: string;
  token: string;
  teamId?: string;
  fetch?: typeof globalThis.fetch;
  readGh?: typeof readGhAccount;
  readVercel?: typeof readVercelGithubLink;
}): Promise<InferredActor | undefined> {
  if (options.explicit !== undefined) {
    const parsed = githubActor.safeParse(options.explicit.trim());
    if (!parsed.success)
      throw new CliError(
        "--credentials-act-as expects a GitHub username or numeric user ID.",
      );
    return {
      actAs: parsed.data,
      ...(parsed.data.startsWith("@") ? { login: parsed.data.slice(1) } : {}),
      source: "explicit",
    };
  }
  const gh = await (options.readGh ?? readGhAccount)();
  if (gh)
    return {
      actAs: gh.id !== undefined ? String(gh.id) : `@${gh.login}`,
      login: gh.login,
      source: "gh",
      profile: {
        login: gh.login,
        ...(gh.name ? { name: gh.name } : {}),
        ...(gh.email ? { email: gh.email } : {}),
        ...(gh.id !== undefined ? { id: String(gh.id) } : {}),
      },
    };
  const link = await (options.readVercel ?? readVercelGithubLink)({
    token: options.token,
    ...(options.teamId ? { teamId: options.teamId } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (!link || (!link.id && !link.login)) return undefined;
  return {
    actAs: link.id ?? `@${link.login}`,
    ...(link.login ? { login: link.login } : {}),
    source: "vercel-account-link",
    profile: link,
  };
}
