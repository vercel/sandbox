import type { Options as RetryOptions } from "async-retry";
import { APIError } from "./api-error.js";
import retry from "async-retry";

export interface RequestOptions {
  onRetry?(error: any, options: RequestOptions): void;
  retry?: Partial<RetryOptions>;
}

/**
 * Wraps a fetch function with retry logic. The retry logic will retry
 * on network errors, 429 responses and 5xx responses. The retry logic
 * will not retry on 4xx responses.
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

    try {
      return (await retry(async (bail) => {
        try {
          if (opts.signal?.aborted) {
            return bail(opts.signal.reason || new Error("Request aborted"));
          }
          const response = await rawFetch(url, opts);

          if (response.status === 429) {
            throw new APIError(response);
          }

          /**
           * If the response is a a retryable error, we throw in
           * order to retry.
           */
          if (response.status >= 500 && response.status < 600) {
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

function isAbortError(error: unknown): error is Error {
  return (
    error !== undefined &&
    error !== null &&
    (error as Error).name === "AbortError"
  );
}
