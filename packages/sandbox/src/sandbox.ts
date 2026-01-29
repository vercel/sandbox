import { run } from "cmd-ts";
import { app } from "./app";
import dotenv from "dotenv-flow";
import { StyledError } from "./error";

dotenv.config({
  silent: true,
});

async function main() {
  try {
    await run(app(), process.argv.slice(2));
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
