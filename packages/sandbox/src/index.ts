import { run as runCmd } from "cmd-ts";
import { app } from "./app";

export function createApp(opts: { withoutAuth: boolean; appName: string }) {
  const instance = app(opts);
  return {
    async run(args: string[]) {
      await runCmd(instance, args);
    },
  };
}
