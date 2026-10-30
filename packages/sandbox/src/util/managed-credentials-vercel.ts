import { z } from "zod";
import { CliError } from "./cli-error";

export interface VercelGithubLink {
  login?: string;
  id?: string;
  name?: string;
  email?: string;
}
const connection = z.object({
  provider: z.string(),
  type: z.string(),
  host: z.string(),
  oauthApp: z.string().optional(),
  login: z.string().nullish(),
  userId: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish(),
  email: z.string().nullish(),
});
const responseSchema = z.object({ connections: z.array(connection) });

export async function readVercelGithubLink(options: {
  token: string;
  teamId?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<VercelGithubLink | undefined> {
  const url = new URL("https://vercel.com/api/v1/integrations/account-links");
  // This is a user-level endpoint; team membership does not select identity.
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      headers: { Authorization: `Bearer ${options.token}` },
      signal: options.signal ?? AbortSignal.timeout(10_000),
    });
  } catch {
    throw lookupFailure();
  }
  if (!response.ok) throw lookupFailure();
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw lookupFailure();
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const candidates = parsed.data.connections.filter(
    (link) =>
      link.provider === "github" &&
      link.type === "login" &&
      link.host === "github.com" &&
      link.oauthApp === "default" &&
      !!link.login,
  );
  if (candidates.length !== 1) return undefined;
  const link = candidates[0];
  const rawId = link.userId;
  const id =
    typeof rawId === "number"
      ? Number.isSafeInteger(rawId) && rawId > 0
        ? String(rawId)
        : undefined
      : typeof rawId === "string" && /^[1-9][0-9]*$/.test(rawId)
        ? rawId
        : undefined;
  return {
    login: link.login!,
    ...(id ? { id } : {}),
    ...(link.name ? { name: link.name } : {}),
    ...(link.email ? { email: link.email } : {}),
  };
}

function lookupFailure() {
  return new CliError(
    "Could not resolve the GitHub account linked to Vercel. Pass --credentials-act-as explicitly or log in with gh.",
    { reason: "identity_lookup_failed" },
  );
}
