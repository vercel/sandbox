import { run as runCmd } from "cmd-ts";
import { app } from "./app";
import { telemetry } from "./telemetry";
import { withAppName } from "./util/app-name";

export function createApp(opts: { withoutAuth: boolean; appName: string }) {
  const instance = app(opts);
  return {
    async run(args: string[]) {
      return withAppName(opts.appName, async () => {
        await telemetry.trackInvocation({ appName: opts.appName, argv: args });
        try {
          await runCmd(instance, args);
          telemetry.trackExitCode(0);
        } catch (error) {
          telemetry.trackExitCode(1);
          throw error;
        } finally {
          await telemetry.flush();
        }
      });
    },
  };
}
