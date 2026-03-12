import type { Sandbox } from "@vercel/sandbox";
import ms from "ms";
import createDebugger from "debug";
import { setTimeout } from "node:timers/promises";

const debug = createDebugger("sandbox:timeout");

const BUFFER = ms("10 seconds");

export async function extendSandboxTimeoutPeriodically(
  sandbox: Sandbox,
  signal: AbortSignal,
) {
  const timeout = sandbox.timeout;
  if (timeout == null) return;

  const nextTick = sandbox.createdAt.getTime() + timeout;
  debug(`next tick: ${new Date(nextTick).toISOString()}`);

  while (!signal.aborted) {
    const currentTimeout = sandbox.timeout;
    if (currentTimeout == null) return;

    const sleepMs =
      sandbox.createdAt.getTime() + currentTimeout - Date.now() - BUFFER;
    if (sleepMs > 2000) {
      debug(`sleeping for ${sleepMs}ms until next timeout extension`);
      await setTimeout(sleepMs, null, { signal });
    }
    await sandbox.extendTimeout(ms("5 minutes"));
    const updatedTimeout = sandbox.timeout;
    if (updatedTimeout == null) return;
    const nextTick = sandbox.createdAt.getTime() + updatedTimeout;
    debug(
      `extended sandbox timeout by 5 minutes. next tick: ${new Date(nextTick).toISOString()}`,
    );
  }
}
