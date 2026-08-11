import { z } from "zod/v4";
import chalk from "chalk";
import createDebugger from "debug";

const debug = createDebugger("sandbox:ai-gateway");

export const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

type Scope = { token: string; project: string; team: string };

/**
 * Environment variables that connect in-sandbox tools to Vercel AI Gateway,
 * authenticated with a short-lived OIDC token scoped to the sandbox's own
 * team and project:
 *
 * - `AI_GATEWAY_API_KEY` is the gateway's own credential variable, checked
 *   first by the AI SDK and read by tools with a built-in gateway provider
 *   (opencode's `vercel/*` model catalog activates on it). The gateway
 *   accepts the OIDC token in its place, and the variable is only ever sent
 *   to the gateway itself.
 * - `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` point Anthropic clients
 *   (like Claude Code) at the gateway's Anthropic-compatible endpoint, which
 *   accepts the OIDC token as a Bearer credential.
 *
 * The token is deliberately injected only twice: the create API caps the
 * `env` payload at 4096 bytes and OIDC tokens run ~1.3KB, so a third copy
 * (e.g. `VERCEL_OIDC_TOKEN`, whose AI SDK role `AI_GATEWAY_API_KEY` already
 * covers with higher precedence) would overflow the limit.
 */
export async function getAiGatewayEnv(
  scope: Scope,
): Promise<Record<string, string>> {
  const token = await getProjectOidcToken(scope);
  return {
    AI_GATEWAY_API_KEY: token,
    ANTHROPIC_BASE_URL: AI_GATEWAY_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: token,
  };
}

/**
 * Memoized per team/project so composite commands (`run` = create + exec)
 * mint at most one token per invocation.
 */
let memo: { key: string; promise: Promise<string> } | undefined;

export function getProjectOidcToken(scope: Scope): Promise<string> {
  const key = `${scope.team}/${scope.project}`;
  if (memo?.key !== key) {
    const promise = mintProjectOidcToken(scope);
    promise.catch(() => {
      memo = undefined;
    });
    memo = { key, promise };
  }
  return memo.promise;
}

/** @internal exported for testing */
export function resetProjectOidcTokenCache(): void {
  memo = undefined;
}

async function mintProjectOidcToken(scope: Scope): Promise<string> {
  // When the CLI itself is authenticated with a project OIDC token (e.g.
  // `VERCEL_OIDC_TOKEN` from `vercel env pull`), that is already the
  // credential a mint would return, so reuse it.
  if (z.jwt().safeParse(scope.token).success) {
    debug("reusing the CLI's OIDC token for AI Gateway");
    return scope.token;
  }

  debug("minting a project OIDC token for %s", scope.project);
  const query = new URLSearchParams({ teamId: scope.team });
  const response = await fetch(
    `https://vercel.com/api/v3/env/pull/${encodeURIComponent(scope.project)}?${query}`,
    { headers: { Authorization: `Bearer ${scope.token}` } },
  );

  if (!response.ok) {
    let message = await response.text();
    try {
      const { error } = JSON.parse(message);
      message = `${error.code.toUpperCase()}: ${error.message}`;
    } catch {}

    throw new Error(
      [
        `Could not obtain AI Gateway credentials (${response.status}): ${message}`,
        `${chalk.bold("hint:")} \`--ai\` needs access to the sandbox's project to issue a token. Check your authentication with \`sandbox login\`.`,
        "╰▶ Docs: https://vercel.com/docs/ai-gateway",
      ].join("\n"),
    );
  }

  const { env } = EnvPullSchema.parse(await response.json());
  const token = env.VERCEL_OIDC_TOKEN;
  if (!token) {
    throw new Error(
      [
        `The project has no OIDC token available, so \`--ai\` cannot issue AI Gateway credentials.`,
        `${chalk.bold("hint:")} Enable "Secure Backend Access with OIDC Federation" in the project settings.`,
        "╰▶ Docs: https://vercel.com/docs/oidc",
      ].join("\n"),
    );
  }

  return token;
}

const EnvPullSchema = z.object({
  env: z.record(z.string(), z.string().optional()).default({}),
});
