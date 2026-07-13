import { run, setDefaultHelpFormatter } from "cmd-ts";
import { app } from "./app";
import dotenv from "dotenv-flow";
import { printTopLevelError } from "./util/format-error";
import { vercelFormatter } from "cmd-ts/batteries/vercel-formatter";
import { setupOtel, trace } from "./otel";

dotenv.config({
  silent: true,
});

async function main() {
  const args = process.argv.slice(2);

  if (!isTracesCommand(args)) {
    await setupOtel();
  }

  setDefaultHelpFormatter(vercelFormatter);

  try {
    await trace(`$ sandbox ${args.join(" ")}`, () => run(app(), args));
  } catch (e) {
    await printTopLevelError(e);
    process.exit(1);
  }
}

function isTracesCommand(args: string[]): boolean {
  return args[0] === "_traces" || args[0] === "traces";
}

main();
