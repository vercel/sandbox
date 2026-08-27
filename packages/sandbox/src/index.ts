import { run as runCmd } from "cmd-ts";
import { app } from "./app";
import { telemetry } from "./telemetry";

export function createApp(opts: { withoutAuth: boolean; appName: string }) {
  const instance = app(opts);
  return {
    async run(args: string[]) {
      await telemetry.trackInvocation({ appName: opts.appName, argv: args });
      try {
        await runCmd(instance, args);
      } finally {
        await telemetry.flush();
      }
    },
  };
}
