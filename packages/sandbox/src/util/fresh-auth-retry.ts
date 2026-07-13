import retry from "async-retry";
import { APIError } from "@vercel/sandbox";
import { NotOk } from "@vercel/sandbox/dist/auth/index.js";
import createDebugger from "debug";
import { isTokenFresh } from "./auth-freshness";

const debug = createDebugger("sandbox:fresh-auth-retry");

/**
 * Run an async operation, transparently retrying on 401/403 when the auth
 * token was just acquired via auto-login.
 */
export async function withFreshAuthRetry<T>(
  factory: () => Promise<T>,
): Promise<T> {
  return retry<T>(
    async (bail, attempt) => {
      try {
        return await factory();
      } catch (error) {
        const status = getAuthFailureStatus(error);
        if (status !== undefined && isTokenFresh()) {
          debug(`fresh-auth retry attempt ${attempt} (status ${status})`);
          throw error;
        }
        bail(error as Error);
        return undefined as never;
      }
    },
    { retries: 5, minTimeout: 500, factor: 2, maxRetryTime: 10_000 },
  );
}

/**
 * Returns the HTTP status if the error represents a 401 or 403.
 * Returns undefined for any other error.
 */
function getAuthFailureStatus(error: unknown): number | undefined {
  let status: number | undefined;
  if (error instanceof APIError) {
    status = error.response.status;
  } else if (error instanceof NotOk) {
    status = error.response.statusCode;
  } else if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object"
  ) {
    // Errors can cross package/bundle boundaries where instanceof is not
    // reliable. Both supported auth error shapes expose status on response.
    const response = error.response as {
      status?: unknown;
      statusCode?: unknown;
    };
    status =
      typeof response.status === "number"
        ? response.status
        : typeof response.statusCode === "number"
          ? response.statusCode
          : undefined;
  }
  return status === 401 || status === 403 ? status : undefined;
}
