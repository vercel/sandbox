import { run, setDefaultHelpFormatter } from "cmd-ts";
import { APIError } from "@vercel/sandbox";
import { app } from "./app";
import dotenv from "dotenv-flow";
import { toFriendlyApiError } from "./client";
import { vercelFormatter } from "cmd-ts/batteries/vercel-formatter";

dotenv.config({
  silent: true,
});

async function main() {
  setDefaultHelpFormatter(vercelFormatter);

  try {
    // We've renamed `sandbox sh` to `sandbox create --connect`. cmd-ts doesn't support aliases for commands
    // with different arguments. Best effort deprecation warning, remap to the new command if the user just
    // runs `sandbox sh ...`
    let args = process.argv.slice(2);
    if (args.length >= 1 && args[0] === "sh") {
      args = ["create", "--connect", ...args.slice(1)];
      process.stderr.write(
        "Warning: `sandbox sh` is deprecated. Please use `sandbox create --connect` instead.\n",
      );
    }

    await run(app(), args);
  } catch (e) {
    await reportError(e);
    process.exit(1);
  }
}

/**
 * Renders a terminal error. Raw {@link APIError}s (thrown by SDK instance
 * methods that skip the client wrapper) become a friendly message; any other
 * error prints its message only, with the stack reserved for `DEBUG` runs.
 */
async function reportError(error: unknown): Promise<void> {
  const normalized =
    error instanceof APIError ? await toFriendlyApiError(error) : error;

  if (normalized instanceof Error) {
    console.error();
    console.error(normalized.message);
    if (process.env.DEBUG) {
      console.error(normalized.stack);
    }
    return;
  }

  console.error(normalized);
}

main();
