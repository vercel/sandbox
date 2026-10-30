import { run as runCmd } from "cmd-ts";
import { app } from "./app";
import { telemetry } from "./telemetry";
import { CliError } from "./util/cli-error";

export function createApp(opts: { withoutAuth: boolean; appName: string }) {
  return {
    async run(args: string[]) {
      await telemetry.trackInvocation({ appName: opts.appName, argv: args });
      try {
        await runCmd(await app(args, opts), args);
        telemetry.trackExitCode(0);
      } catch (error) {
        if (error instanceof CliError) {
          telemetry.trackExitCode(error.exitCode);
          if (error.options.json) error.writeJson();
          else process.stderr.write(error.message + "\n");
          process.exitCode = error.exitCode;
          return;
        }
        telemetry.trackExitCode(1);
        throw error;
      } finally {
        await telemetry.flush();
      }
    },
  };
}
