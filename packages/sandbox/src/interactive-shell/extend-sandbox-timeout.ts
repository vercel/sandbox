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
  const nextTick = sandbox.createdAt.getTime() + sandbox.timeout;
  debug(`next tick: ${new Date(nextTick).toISOString()}`);

  while (!signal.aborted) {
    const timeout =
      sandbox.createdAt.getTime() + sandbox.timeout - Date.now() - BUFFER;
    if (timeout > 2000) {
      debug(`sleeping for ${timeout}ms until next timeout extension`);
      await setTimeout(timeout, null, { signal });
    }
    await sandbox.extendTimeout(ms("5 minutes"));
    const nextTick = sandbox.createdAt.getTime() + sandbox.timeout;
    debug(
      `extended sandbox timeout by 5 minutes. next tick: ${new Date(nextTick).toISOString()}`,
    );
  }
}
