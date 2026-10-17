import * as cmd from "cmd-ts";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";

const target = {
  sandbox: cmd.positional({ type: sandboxName }),
  groupname: cmd.positional({
    displayName: "groupname",
    description: "Linux group name",
  }),
  scope,
} as const;

const create = cmd.command({
  name: "create",
  description: "Create a Linux group and its shared directory",
  args: target,
  async handler({ sandbox: name, groupname, scope: { token, team, project } }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
      resume: true,
    });
    const group = await sandbox.createGroup(groupname);
    process.stdout.write(`${group.groupname}\t${group.sharedDir}\n`);
  },
});

const membership = {
  ...target,
  username: cmd.positional({
    displayName: "username",
    description: "Linux user name",
  }),
} as const;

const addUser = cmd.command({
  name: "add-user",
  description: "Add a user to a group",
  args: membership,
  async handler({
    sandbox: name,
    groupname,
    username,
    scope: { token, team, project },
  }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
      resume: true,
    });
    await sandbox.addUserToGroup(username, groupname);
    process.stdout.write(`${username}\t${groupname}\n`);
  },
});

const removeUser = cmd.command({
  name: "remove-user",
  description: "Remove a user from a group",
  args: membership,
  async handler({
    sandbox: name,
    groupname,
    username,
    scope: { token, team, project },
  }) {
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
      resume: true,
    });
    await sandbox.removeUserFromGroup(username, groupname);
    process.stdout.write(`${username}\t${groupname}\n`);
  },
});

export const groups = cmd.subcommands({
  name: "groups",
  description: "Create groups and manage their users",
  cmds: { create, "add-user": addUser, "remove-user": removeUser },
});
