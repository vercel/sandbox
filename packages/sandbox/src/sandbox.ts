import { run, setDefaultHelpFormatter } from "cmd-ts";
import { app } from "./app";
import dotenv from "dotenv-flow";
import { steerShCommand } from "./util/steer-sh";
import { vercelFormatter } from "cmd-ts/batteries/vercel-formatter";
import { telemetry } from "./telemetry";
import { CliError } from "./util/cli-error";

// Called by bin/sandbox.mjs. tsdown can make lazy-loaded command chunks import
// this entry, so it must not run anything on import (test/bundle.test.ts).
export async function main() {
  dotenv.config({
    silent: true,
  });
  setDefaultHelpFormatter(vercelFormatter);

  const argv = process.argv.slice(2);
  await telemetry.trackInvocation({ appName: "sandbox", argv });

  try {
    steerShCommand(argv);
    await run(await app(argv), argv);
    telemetry.trackExitCode(0);
    await telemetry.flush();
  } catch (e) {
    const exitCode = e instanceof CliError ? e.exitCode : 1;
    telemetry.trackExitCode(exitCode);
    await telemetry.flush();
    const { printTopLevelError } = await import("./util/format-error");
    if (e instanceof CliError && e.options.json) e.writeJson();
    else await printTopLevelError(e);
    process.exit(exitCode);
  }
}
