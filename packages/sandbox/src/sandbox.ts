import { run, setDefaultHelpFormatter } from "cmd-ts";
import { app } from "./app";
import dotenv from "dotenv-flow";
import { printTopLevelError } from "./util/format-error";
import { vercelFormatter } from "cmd-ts/batteries/vercel-formatter";
import { SpanStatusCode } from "@opentelemetry/api";
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
    const command = getCommandName(args);
    await trace(`sandbox ${command}`, async (span) => {
      span.setAttribute("cli.command", command);
      await run(app(), args);
      if (process.exitCode && process.exitCode !== 0) {
        span.setAttribute("cli.exit_code", process.exitCode);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Command exited with code ${process.exitCode}`,
        });
      }
    });
  } catch (e) {
    await printTopLevelError(e);
    process.exit(1);
  }
}

function getCommandName(args: string[]): string {
  const command = args.find((arg) => COMMAND_NAMES.has(arg));
  return command ?? "unknown";
}

const COMMAND_NAMES = new Set([
  "config",
  "connect",
  "copy",
  "cp",
  "create",
  "exec",
  "fork",
  "list",
  "login",
  "logout",
  "remove",
  "rm",
  "run",
  "sessions",
  "sh",
  "snapshot",
  "snapshots",
  "stop",
]);

function isTracesCommand(args: string[]): boolean {
  return args[0] === "_traces" || args[0] === "traces";
}

main();
