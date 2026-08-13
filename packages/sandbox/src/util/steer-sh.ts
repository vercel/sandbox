import chalk from "chalk";
import { StyledError } from "../error";

/**
 * `sandbox sh claude` is the most natural way to ask for "run this command in
 * a sandbox", but `sh` takes no command. Declaring a catch-all positional on
 * `sh` would advertise a command argument in its help and generated docs
 * (review feedback on #295), so the steer runs here, before the parser's
 * generic "Unknown arguments" rejection.
 *
 * Only leading non-flag tokens after `sh` are treated as a command attempt:
 * they cannot be option values, so the check can never misread a valid
 * invocation like `sandbox sh --name my-box`. Anything trickier falls through
 * to the parser's normal error.
 */
export function steerShCommand(args: string[]): void {
  if (args[0] !== "sh") {
    return;
  }
  const command: string[] = [];
  for (const arg of args.slice(1)) {
    if (arg.startsWith("-")) {
      break;
    }
    command.push(arg);
  }
  if (command.length === 0) {
    return;
  }
  const example = command.join(" ");
  throw new StyledError(
    [
      "`sh` starts a plain shell and doesn't take a command.",
      `${chalk.bold("hint:")} to run ${chalk.cyan(example)} interactively in a new sandbox:`,
      `╰▶ sandbox run -i ${example}`,
    ].join("\n"),
  );
}
