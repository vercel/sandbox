import * as cmd from "cmd-ts";
import { login } from "../commands/login";
import createDebugger from "debug";
import chalk from "chalk";
import {
  getVercelOidcToken,
  getVercelToken,
  AccessTokenMissingError,
  RefreshAccessTokenFailedError,
} from "@vercel/oidc";

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
          // Note: getVercelOidcToken() can optionally accept { project, team } parameters
          // to explicitly specify the scope. `project` must be a project ID (prj_*),
          // `team` accepts both IDs (team_*) and slugs. If not provided, it will
          // read from .vercel/project.json automatically.
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

      // Try to get CLI token, which handles auth.json reading and refresh
      try {
        return await getVercelToken();
      } catch (error) {
        // Handle specific auth errors by triggering login
        if (
          error instanceof AccessTokenMissingError ||
          error instanceof RefreshAccessTokenFailedError
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

          // Try again after login
          try {
            return await getVercelToken();
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
    },
  },
});

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
