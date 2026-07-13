import { MockServer } from "./server/mock-server.js";
import type { CommandHandler } from "./handlers.js";

/**
 * The process-wide mock server backing the drop-in {@link Sandbox} and
 * {@link Snapshot} exports. Each Vitest test file runs in its own module
 * instance, so this is already isolated per file; use {@link setupSandbox}'s
 * `resetHandlers` for isolation between tests in the same file.
 */
export const defaultServer = new MockServer();

interface MockDefaults {
  token: string;
  teamId: string;
  projectId: string;
  fetch: typeof globalThis.fetch;
}

/**
 * Inject the mock credentials and mocked `fetch` into a set of SDK params.
 * User-supplied fields win, but `fetch` is always the mock server so requests
 * can never escape to the network.
 */
export function withMockDefaults<T>(params: T): T & MockDefaults {
  return {
    ...defaultServer.credentials,
    ...(params ?? {}),
    fetch: defaultServer.fetch,
  } as T & MockDefaults;
}

/**
 * Control which commands are stubbed on the mock server. Handlers registered
 * here override just-bash execution for matching commands — the escape hatch
 * for commands just-bash can't run (e.g. `npm install`).
 *
 * Handlers are bound when a sandbox starts, so register them before
 * `Sandbox.create()`; adding handlers afterwards has no effect on an
 * already-running sandbox.
 *
 * @param handlers - Baseline handlers applied to every sandbox created
 *   afterwards.
 * @returns Controls to add per-test handlers (`use`) and reset state
 *   (`resetHandlers`), mirroring an MSW-style server.
 */
export function setupSandbox(...handlers: CommandHandler[]): {
  use: (...handlers: CommandHandler[]) => void;
  resetHandlers: () => void;
} {
  defaultServer.setDefaultHandlers(handlers);
  return {
    use: (...runtime: CommandHandler[]) => defaultServer.use(runtime),
    resetHandlers: () => {
      // MSW semantics: drop per-test `use()` overrides and in-memory state,
      // but restore the baseline handlers passed to this `setupSandbox` call
      // rather than wiping them.
      defaultServer.setDefaultHandlers(handlers);
      defaultServer.reset();
    },
  };
}
