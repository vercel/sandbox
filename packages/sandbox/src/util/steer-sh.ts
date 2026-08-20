import chalk from "chalk";
import { StyledError } from "../error";

/**
 * `sandbox sh claude` is the most natural way to ask for "run this command in
 * a sandbox", but `sh` takes no command. Declaring a catch-all positional on
 * `sh` would advertise a command argument in its help and generated docs
 * (review feedback on #295), so the steer runs here, before the parser's
 * generic "Unknown arguments" rejection.
 *
 * The check only fires when the FIRST token after `sh` is a non-flag: that
 * token can never be an option value, so a valid invocation like
 * `sandbox sh --name my-box` can never be misread. Once it fires, the whole
 * tail is treated as the intended command (including its own flags), so
 * `sandbox sh example-command -t 0` suggests `example-command -t 0`, not a
 * truncated version of it.
 */
export function steerShCommand(args: string[]): void {
  if (args[0] !== "sh") {
    return;
  }
  const rest = args.slice(1);
  if (rest.length === 0 || rest[0].startsWith("-")) {
    return;
  }
  const example = rest.join(" ");
  throw new StyledError(
    [
      "`sh` starts a plain shell and doesn't take a command.",
      `${chalk.bold("hint:")} to run ${chalk.cyan(example)} interactively in a new sandbox:`,
      `╰▶ sandbox run -i ${example}`,
    ].join("\n"),
  );
}
