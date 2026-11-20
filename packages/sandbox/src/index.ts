import { run as runCmd } from "cmd-ts";
import { app } from "./app";
import { telemetry } from "./telemetry";
import { exitCodeOf } from "./error";

export function createApp(opts: { withoutAuth: boolean; appName: string }) {
  return {
    async run(args: string[]) {
      await telemetry.trackInvocation({ appName: opts.appName, argv: args });
      try {
        await runCmd(await app(args, opts), args);
        telemetry.trackExitCode(0);
      } catch (error) {
        telemetry.trackExitCode(exitCodeOf(error));
        throw error;
      } finally {
        await telemetry.flush();
      }
    },
  };
}
