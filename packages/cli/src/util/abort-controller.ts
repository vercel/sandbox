/**
 * When working with AbortSignals, it's common to encounter errors that are a result of the signal being aborted.
 * This utility function helps to ignore those specific errors, allowing the program to continue its execution without being interrupted by them.
 *
 * @example
 * const controller = new AbortController();
 * fetch(URL, { signal: controller.signal }).catch(
 *   ignoreAbortErrors(controller.signal) // we don't care if it errored as it was aborted
 * )
 */
export function ignoreAbortErrors(signal: AbortSignal) {
  return (err: unknown) => {
    if (signal.aborted) {
      return;
    }
    throw err;
  };
}
