import { run, setDefaultHelpFormatter } from "cmd-ts";
import { app } from "./app";
import dotenv from "dotenv-flow";
import { printTopLevelError } from "./util/format-error";
import { steerShCommand } from "./util/steer-sh";
import { vercelFormatter } from "cmd-ts/batteries/vercel-formatter";
import { telemetry } from "./telemetry";

dotenv.config({
  silent: true,
});

async function main() {
  setDefaultHelpFormatter(vercelFormatter);

  const argv = process.argv.slice(2);
  await telemetry.trackInvocation({ appName: "sandbox", argv });

  try {
    steerShCommand(argv);
    await run(app(), argv);
    telemetry.trackExitCode(0);
    await telemetry.flush();
  } catch (e) {
    telemetry.trackExitCode(1);
    await telemetry.flush();
    await printTopLevelError(e);
    process.exit(1);
  }
}

main();
