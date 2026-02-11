import { run } from "cmd-ts";
import { app } from "./app";
import dotenv from "dotenv-flow";
import { StyledError } from "./error";
import { printHelp } from "./help";

dotenv.config({
  silent: true,
});

async function main() {
  try {
    let args = process.argv.slice(2);

    if (
      args.length === 0 ||
      (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
    ) {
      printHelp();
      return;
    }

    // We've renamed `sandbox sh` to `sandbox create --connect`. cmd-ts doesn't support aliases for commands
    // with different arguments. Best effort deprecation warning, remap to the new command if the user just
    // runs `sandbox sh ...`
    if (args.length >= 1 && args[0] === "sh") {
      args = ["create", "--connect", ...args.slice(1)];
      process.stderr.write('Warning: `sandbox sh` is deprecated. Please use `sandbox create --connect` instead.\n');
    }

    await run(app(), args);
  } catch (e) {
    if (e instanceof StyledError) {
      console.error();
      console.error(e.message);
      process.exit(1);
    }

    console.error(e);
    process.exit(1);
  }
}

main();
