import { run, setDefaultHelpFormatter } from "cmd-ts";
import { app } from "./app";
import dotenv from "dotenv-flow";
import { printTopLevelError } from "./util/format-error";
import { vercelFormatter } from "cmd-ts/batteries/vercel-formatter";

dotenv.config({
  silent: true,
});

async function main() {
  setDefaultHelpFormatter(vercelFormatter);

  try {
    await run(app(), process.argv.slice(2));
  } catch (e) {
    await printTopLevelError(e);
    process.exit(1);
  }
}

main();
