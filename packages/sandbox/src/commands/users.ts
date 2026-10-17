import * as cmd from "cmd-ts";
import ms from "ms";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { ObjectFromKeyValue } from "../args/key-value-pair";
import { Duration } from "../types/duration";
import { sandboxClient } from "../client";

const target = {
  sandbox: cmd.positional({ type: sandboxName }),
  username: cmd.positional({
    displayName: "username",
    description: "Linux user name",
  }),
  scope,
} as const;

const create = cmd.command({
  name: "create",
  description: "Create a Linux user with an isolated home directory",
  args: target,
  async handler({ sandbox: name, username, scope: { token, team, project } }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
      resume: true,
    });
    const user = await sandbox.createUser(username);
    process.stdout.write(`${user.username}\t${user.homeDir}\n`);
  },
});

const exec = cmd.command({
  name: "exec",
  description: "Run a command as a Linux user",
  args: {
    ...target,
    command: cmd.positional({
      displayName: "command",
      description: "Executable",
    }),
    args: cmd.rest({ displayName: "args", description: "Command arguments" }),
    cwd: cmd.option({
      long: "workdir",
      short: "w",
      description: "Working directory (defaults to the user's home)",
      type: cmd.optional(cmd.string),
    }),
    envVars: cmd.multioption({
      long: "env",
      short: "e",
      description: "Environment variables for the command",
      type: ObjectFromKeyValue,
    }),
    detached: cmd.flag({
      long: "detach",
      description: "Start the command and print its ID without waiting",
    }),
    stdin: cmd.flag({
      long: "stdin",
      description:
        "Forward local stdin, or keep detached stdin open for later writes",
    }),
    timeout: cmd.option({
      long: "timeout",
      description: "Maximum command duration",
      type: cmd.optional(Duration),
    }),
  },
  async handler({
    sandbox: name,
    username,
    command,
    args,
    cwd,
    envVars,
    detached,
    stdin,
    timeout,
    scope: { token, team, project },
  }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
      resume: true,
    });
    const user = sandbox.asUser(username);
    if (detached) {
      const started = await user.runCommand({
        cmd: command,
        args,
        cwd,
        env: envVars,
        timeoutMs: timeout ? ms(timeout) : undefined,
        detached: true,
        stdin: stdin ? true : undefined,
      });
      process.stdout.write(`${started.cmdId}\n`);
      return;
    }
    const finished = await user.runCommand({
      cmd: command,
      args,
      cwd,
      env: envVars,
      timeoutMs: timeout ? ms(timeout) : undefined,
      stdout: process.stdout,
      stderr: process.stderr,
      stdin: stdin ? process.stdin : undefined,
    });
    process.exitCode = finished.exitCode;
  },
});

export const users = cmd.subcommands({
  name: "users",
  description: "Create users and run commands as a user",
  cmds: { create, exec },
});
