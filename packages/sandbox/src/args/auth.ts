import * as cmd from "cmd-ts";
import { login } from "../commands/login";
import createDebugger from "debug";
import chalk from "chalk";
import {
  getAuth,
  updateAuthConfig,
  isOAuthError,
  OAuth,
} from "@vercel/sandbox/dist/auth/index.js";
import { getVercelOidcToken } from "@vercel/oidc";

const debug = createDebugger("sandbox:args:auth");

export const token = cmd.option({
  long: "token",
  description:
    "A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process.",
  type: {
    ...cmd.string,
    displayName: "pat_or_oidc",
    defaultValueIsSerializable: false,
    onMissing: async () => {
      if (process.env.VERCEL_AUTH_TOKEN) {
        return process.env.VERCEL_AUTH_TOKEN;
      }

      if (process.env.VERCEL_OIDC_TOKEN) {
        try {
          return await getVercelOidcToken();
        } catch (cause) {
          debug(`Failed to get or refresh OIDC token: ${getMessage(cause)}`);
          console.warn(
            chalk.yellow(
              `${chalk.bold("warn:")} failed to get or refresh OIDC token, using personal token authentication.`,
            ),
          );
        }
      }

      let auth = getAuth();

      // If there's no auth token, run the login command
      if (!auth) {
        await login.handler({});
        auth = getAuth();
      }

      if (auth) {
        const refreshed = await refreshToken(auth);
        if (typeof refreshed === "object") {
          auth = refreshed;
        } else if (
          refreshed === "missing refresh token" ||
          refreshed === "invalid refresh token"
        ) {
          console.warn(
            chalk.yellow(
              `${chalk.bold("notice:")} Your session has expired. Please log in again.`,
            ),
          );
          await login.handler({});
          auth = getAuth();
        }
      }

      if (!auth || !auth.token) {
        throw new Error(
          [
            `Failed to retrieve authentication token.`,
            `${chalk.bold("hint:")} Try logging in again with \`sandbox login\`.`,
            "╰▶ Docs: https://vercel.com/docs/vercel-sandbox/cli-reference#authentication",
          ].join("\n"),
        );
      }

      return auth.token;
    },
  },
});

async function refreshToken(file: NonNullable<ReturnType<typeof getAuth>>) {
  if (!file.expiresAt) return;
  if (file.expiresAt.getTime() > Date.now()) {
    return "not expired" as const;
  }

  if (!file.refreshToken) {
    debug(`Token expired, yet refresh token unavailable.`);
    return "missing refresh token" as const;
  }

  debug(`Refreshing token (expired at ${file.expiresAt.toISOString()})`);
  const oauth = await OAuth();
  const newToken = await oauth.refreshToken(file.refreshToken).catch((err) => {
    if (isOAuthError(err)) {
      return null;
    }
    throw err;
  });
  if (!newToken) {
    return "invalid refresh token" as const;
  }
  updateAuthConfig({
    expiresAt: new Date(Date.now() + newToken.expires_in * 1000),
    token: newToken.access_token,
    refreshToken: newToken.refresh_token || file.refreshToken,
  });
  const updated = getAuth();
  debug(`Token stored. expires at ${updated?.expiresAt?.toISOString()})`);
  return updated;
}

function getMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  let message = error.message;
  if (error.cause) {
    message += `\nCaused by: ${getMessage(error.cause)}`;
  }

  return message;
}
