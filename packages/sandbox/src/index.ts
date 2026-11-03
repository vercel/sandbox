import { run as runCmd } from "cmd-ts";
import type { AuthHeadersProvider } from "@vercel/sandbox";
import { app } from "./app";
import { setAuthHeadersProvider } from "./auth-headers";
import { telemetry } from "./telemetry";

export function createApp(opts: {
  withoutAuth: boolean;
  appName: string;
  /**
   * Authenticate API requests with these headers instead of a token, unless
   * `--token` or `VERCEL_AUTH_TOKEN` is given. Called for every request,
   * retries included, so it can sign a new DPoP proof each time.
   */
  getAuthHeaders?: AuthHeadersProvider;
}) {
  return {
    async run(args: string[]) {
      setAuthHeadersProvider(opts.getAuthHeaders);
      await telemetry.trackInvocation({ appName: opts.appName, argv: args });
      try {
        await runCmd(await app(args, opts), args);
        telemetry.trackExitCode(0);
      } catch (error) {
        telemetry.trackExitCode(1);
        throw error;
      } finally {
        await telemetry.flush();
      }
    },
  };
}
