import { ignoreAbortErrors } from "./abort-controller";

/**
 * Utility function that allows to acquire a resource
 * colocated with its release logic
 *
 * @example
 * using resource = acquireRelease(
 *   () => new AbortController(),
 *   (c) => c.abort(),
 * );
 */
export function acquireRelease<T extends object>(
  fn: () => T,
  release: (t: NoInfer<T>) => void,
): T & Disposable {
  const value = fn();
  return Object.assign(value, {
    [Symbol.dispose]: () => release(value),
  });
}

/**
 * Utility function that allows to create a disposable
 * with a custom dispose logic like Golang's `defer`
 * which allows us to avoid `try/finally` blocks.
 */
export function defer(fn: () => void) {
  return { [Symbol.dispose]: fn };
}

/**
 * Creates an AbortController that is also disposable,
 * which aborts when disposed with a given reason.
 */
export function createAbortController(reason: string) {
  return acquireRelease(
    () => {
      const controller = new AbortController();
      return {
        abort: (newReason?: string) => controller.abort(newReason ?? reason),
        signal: controller.signal,
        /**
         * When working with AbortSignals, it's common to encounter errors that are a result of the signal being aborted.
         * This utility function helps to ignore those specific errors, allowing the program to continue its execution without being interrupted by them.
         *
         * @example
         * using controller = createAbortController("My reason");
         * fetch(URL, { signal: controller.signal }).catch(
         *   controller.ignoreInterruptions // we don't care if it errored as it was aborted
         * )
         */
        ignoreInterruptions: ignoreAbortErrors(controller.signal),
      };
    },
    (c) => c.abort(reason),
  );
}
