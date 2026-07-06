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
  await setupOtel();
  setDefaultHelpFormatter(vercelFormatter);

  try {
    await trace(`$ sandbox ${process.argv.slice(2).join(" ")}`, () =>
      run(app(), process.argv.slice(2)),
    );
  } catch (e) {
    await printTopLevelError(e);
    process.exit(1);
  }
}

main();
