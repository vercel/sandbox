import * as cmd from "cmd-ts";
import { login } from "../commands/login";
import createDebugger from "debug";
import chalk from "chalk";
import * as OIDC from "@vercel/oidc";
import { getCurrentSpan, traced } from "../otel";
import { traceParser } from "../util/parser-trace";
import { getAuth } from "@vercel/sandbox/dist/auth/index.js";

const debug = createDebugger("sandbox:args:auth");

let freshTokenAcquiredAt: number | undefined;

const FRESH_TOKEN_WINDOW_MS = 15_000;

export function isTokenFresh(): boolean {
  return (
    freshTokenAcquiredAt !== undefined &&
    Date.now() - freshTokenAcquiredAt < FRESH_TOKEN_WINDOW_MS
  );
}

function markTokenAsFresh(): void {
  freshTokenAcquiredAt = Date.now();
}

const getVercelOidcToken = traced(OIDC.getVercelOidcToken);
const getVercelToken = traced(OIDC.getVercelToken);

export const token = traceParser(
  "token",
  cmd.option({
    long: "token",
    description:
      "A Vercel authentication token. If not provided, will use the token stored in your system from `VERCEL_AUTH_TOKEN` or will start a log in process.",
    type: {
      ...cmd.string,
      displayName: "pat_or_oidc",
      defaultValueIsSerializable: false,
      onMissing: traced({ name: "auth.onMissing" }, async () => {
        if (process.env.VERCEL_AUTH_TOKEN) {
          getCurrentSpan()?.setAttribute("auth.source", "environment");
          return process.env.VERCEL_AUTH_TOKEN;
        }

        if (process.env.VERCEL_OIDC_TOKEN) {
          try {
            const oidcToken = await getVercelOidcToken();
            getCurrentSpan()?.setAttribute("auth.source", "oidc");
            return oidcToken;
          } catch (cause) {
            getCurrentSpan()?.addEvent("auth.oidc_fallback");
            debug(`Failed to get or refresh OIDC token: ${getMessage(cause)}`);
            console.warn(
              chalk.yellow(
                `${chalk.bold("warn:")} failed to get or refresh OIDC token, using personal token authentication.`,
              ),
            );
          }
        }

        // Try to get CLI token, which handles auth.json reading and refresh
        try {
          const previousToken = getAuth()?.token;
          const storedToken = await getVercelToken();
          if (previousToken && storedToken !== previousToken) {
            markTokenAsFresh();
            getCurrentSpan()?.addEvent("auth.token_refreshed");
          }
          getCurrentSpan()?.setAttribute("auth.source", "stored");
          return storedToken;
        } catch (error) {
          // Handle specific auth errors by triggering login
          if (
            error instanceof OIDC.AccessTokenMissingError ||
            error instanceof OIDC.RefreshAccessTokenFailedError
          ) {
            debug(
              `CLI token unavailable (${error.name}), prompting for login...`,
            );
            console.warn(
              chalk.yellow(
                `${chalk.bold("notice:")} Your session has expired. Please log in again.`,
              ),
            );
            await login.handler({});
            getCurrentSpan()?.addEvent("auth.login_completed");

            // Try again after login
            try {
              const refreshed = await getVercelToken();
              markTokenAsFresh();
              getCurrentSpan()?.setAttribute("auth.source", "login");
              return refreshed;
            } catch (retryError) {
              throw new Error(
                [
                  `Failed to retrieve authentication token.`,
                  `${chalk.bold("hint:")} Try logging in again with \`sandbox login\`.`,
                  "╰▶ Docs: https://vercel.com/docs/vercel-sandbox/cli-reference#authentication",
                ].join("\n"),
              );
            }
          }

          // Re-throw unexpected errors
          throw error;
        }
      }),
    },
  }),
);

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
