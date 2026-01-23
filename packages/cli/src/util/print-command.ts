import chalk from "chalk";

export function printCommand(sandbox: string, command: string, args: string[]) {
  return chalk.gray(chalk.dim(`${sandbox} $ `) + [command, ...args].join(" "));
}
