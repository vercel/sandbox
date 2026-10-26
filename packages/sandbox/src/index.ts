import { run as runCmd } from "cmd-ts";
import { app } from "./app";
import { telemetry } from "./telemetry";
import { setGetAuthHeaders, type GetAuthHeaders } from "./client";

export type { GetAuthHeaders };

export function createApp(opts: {
  withoutAuth: boolean;
  appName: string;
  /**
   * Returns the auth headers for each API request instead of sending the
   * token as `Bearer`, for example a DPoP proof.
   */
  getAuthHeaders?: GetAuthHeaders;
}) {
  return {
    async run(args: string[]) {
      await telemetry.trackInvocation({ appName: opts.appName, argv: args });
      setGetAuthHeaders(opts.getAuthHeaders);
      try {
        await runCmd(await app(args, opts), args);
        telemetry.trackExitCode(0);
      } catch (error) {
        telemetry.trackExitCode(1);
        throw error;
      } finally {
        setGetAuthHeaders(undefined);
        await telemetry.flush();
      }
    },
  };
}
