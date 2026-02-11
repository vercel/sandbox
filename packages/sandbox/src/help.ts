import chalk from "chalk";
import { version, packageName, logo, getTitleName } from "./pkg";

function cmd(cmdName: string, args: string, desc: string): string {
  return `      ${cmdName.padEnd(21)}${chalk.dim(args.padEnd(12))}${chalk.dim(desc)}`;
}

export function printHelp() {
  console.log(chalk.grey(`${getTitleName()} ${version}`));
  console.log(`
  ${chalk.bold(`${logo} ${packageName}`)} [options] <command>

  ${chalk.dim(`For command help, run \`${packageName} <command> --help\``)}

  ${chalk.dim("Commands:")}

    ${chalk.dim("Sandbox")}

${cmd("create", "", "Create a new sandbox")}
${cmd("ls | list", "", "List sandboxes for the current project")}
${cmd("run", "[cmd]", "Create and run a command in a sandbox")}
${cmd("rm | stop", "[id...]", "Stop one or more running sandboxes")}

    ${chalk.dim("Interaction")}

${cmd("ssh | connect", "[id]", "Start an interactive shell in a sandbox")}
${cmd("exec", "[id] [cmd]", "Execute a command in a sandbox")}
${cmd("cp | copy", "[src] [dst]", "Copy files between local and remote")}

    ${chalk.dim("Snapshots & Config")}

${cmd("snapshot", "[id]", "Take a filesystem snapshot of a sandbox")}
${cmd("snapshots", "[cmd]", "Manage sandbox snapshots")}
${cmd("config", "[cmd]", "Update sandbox configuration")}

    ${chalk.dim("Auth")}

${cmd("login", "", "Log in to the Sandbox CLI")}
${cmd("logout", "", "Log out of the Sandbox CLI")}

  ${chalk.dim("Examples:")}

  ${chalk.gray("–")} Create a sandbox and start a shell

    ${chalk.cyan(`$ ${packageName} create --connect`)}

  ${chalk.gray("–")} Run a command in a new sandbox

    ${chalk.cyan(`$ ${packageName} run -- node -e "console.log('hello')"`)}

  ${chalk.gray("–")} Execute a command in an existing sandbox

    ${chalk.cyan(`$ ${packageName} exec <sandbox-id> -- npm test`)}

`);
}
