import type { Options as RetryOptions } from "async-retry";
import { APIError } from "./api-error.js";
import retry from "async-retry";

export interface RequestOptions {
  onRetry?(error: any, options: RequestOptions): void;
  retry?: Partial<RetryOptions>;
}

/**
 * HTTP methods that are safe to retry on network errors and arbitrary 5xx
 * responses. Unsafe methods (POST/PUT/PATCH/DELETE) may have already started
 * side-effecting work, so they are only retried on 429 and 503.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isUnsafeMethod(method?: string): boolean {
  return !SAFE_METHODS.has((method ?? "GET").toUpperCase());
}

/**
 * Wraps a fetch function with retry logic.
 *
 * Safe methods (GET/HEAD/OPTIONS) retry on network errors, 429 responses, and
 * 5xx responses. Unsafe methods (POST/PUT/PATCH/DELETE) only retry on 429 and
 * 503, where the server has not accepted the request. They do not retry on
 * network errors or other 5xx responses, which can mean the server already
 * started the work (for example `runCommand` starting a process).
 *
 * @param rawFetch The fetch function to wrap.
 * @returns The wrapped fetch function.
 */
export function withRetry<T extends RequestInit>(
  rawFetch: (url: URL | string, init?: T) => Promise<Response>,
) {
  return async (
    url: URL | string,
    opts: T & RequestOptions = <T & RequestOptions>{},
  ) => {
    /**
     * Timeouts by default will be [400, 800]
     * before randomization is added.
     */
    const retryOpts = Object.assign(
      {
        minTimeout: 400,
        retries: 2,
        factor: 2,
      },
      opts.retry,
    );

    if (opts.onRetry) {
      retryOpts.onRetry = (error, attempts) => {
        opts.onRetry!(error, opts);
        if (opts.retry && opts.retry.onRetry) {
          opts.retry.onRetry(error, attempts);
        }
      };
    }

    const unsafe = isUnsafeMethod(opts.method);

    try {
      return (await retry(async (bail, attempt) => {
        try {
          if (opts.signal?.aborted) {
            return bail(opts.signal.reason || new Error("Request aborted"));
          }
          const response = await rawFetch(url, opts);

          if (response.status === 429) {
            const retryAfter = Number(response.headers.get("Retry-After"));

            // Bail if the retry-after is in more than 20 seconds, as we don't
            // want to wait for that long before returning to the client.
            if (retryAfter > 20) {
              return bail(new APIError(response));
            }

            const hasRetriesRemaining =
              retryOpts.forever || attempt <= retryOpts.retries;
            if (retryAfter > 0 && hasRetriesRemaining) {
              await waitForRetry(retryAfter * 1000, opts.signal);
            }

            throw new APIError(response);
          }

          /**
           * Unsafe methods only retry 503 among 5xx statuses. Other 5xx can
           * mean the server already accepted and started the request.
           */
          if (response.status >= 500 && response.status < 600) {
            if (unsafe && response.status !== 503) {
              return response;
            }
            throw new APIError(response);
          }

          return response;
        } catch (error) {
          /**
           * If the request was aborted using the AbortController
           * we bail from retrying throwing the original error.
           */
          if (isAbortError(error)) {
            return bail(error);
          }

          /**
           * If the signal was aborted meanwhile we were
           * waiting, we bail from retrying.
           */
          if (opts.signal?.aborted) {
            return bail(opts.signal.reason || new Error("Request aborted"));
          }

          /**
           * Network errors after an unsafe method are ambiguous: the server
           * may already have started the work. Do not retry.
           */
          if (unsafe && !(error instanceof APIError)) {
            return bail(error);
          }

          throw error;
        }
      }, retryOpts)) as Response;
    } catch (error) {
      /**
       * The ResponseError is only intended for retries so in case we
       * ran out of attempts we will respond with the last response
       * we obtained.
       */
      if (error instanceof APIError) {
        return error.response;
      }

      throw error;
    }
  };
}

async function waitForRetry(delay: number, signal?: AbortSignal | null) {
  if (signal?.aborted) {
    throw signal.reason || new Error("Request aborted");
  }

  await new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason || new Error("Request aborted"));
    };

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(null);
    }, delay);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): error is Error {
  return (
    error !== undefined &&
    error !== null &&
    (error as Error).name === "AbortError"
  );
}
