import { defineCommand } from "just-bash";
import type { Command, CommandContext, ExecResult } from "just-bash";
import type { UserState } from "./registry.js";

const ok = (stdout = ""): ExecResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string, exitCode = 1): ExecResult => ({
  stdout: "",
  stderr: stderr.endsWith("\n") ? stderr : `${stderr}\n`,
  exitCode,
});

/** Positional (non-flag) args, skipping flags and the values of value-flags. */
function positionals(args: string[], valueFlags: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      if (valueFlags.has(arg)) i++; // consume the flag's value
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Custom just-bash commands that emulate the Linux user/group tooling the SDK
 * shells out to for multi-user support (`useradd`, `id`, ...). There is no real
 * OS isolation — these read and mutate the shared {@link UserState} so the
 * SDK's `exitCode`/stdout assertions behave like they do against a real
 * sandbox. `sudo` is handled in the executor, not here.
 */
export function buildUserCommands(state: UserState): Command[] {
  const exists = (user: string) =>
    user === "root" || user === state.defaultUser || state.users.has(user);

  const primaryGroup = (user: string): string | undefined => {
    if (user === "root") return "root";
    if (user === state.defaultUser) return state.defaultGroup;
    return state.users.get(user)?.group;
  };

  const id = defineCommand("id", async (args: string[]): Promise<ExecResult> => {
    const flag = args.find((a) => a.startsWith("-")) ?? "";
    const target = positionals(args, new Set())[0] ?? state.defaultUser;
    if (!exists(target)) return fail(`id: ‘${target}’: no such user`);
    if (flag.includes("g")) {
      const group = primaryGroup(target);
      return group ? ok(`${group}\n`) : fail(`id: ‘${target}’: no such user`);
    }
    // Default and `-u`: report the login name.
    return ok(`${target}\n`);
  });

  const useradd = defineCommand(
    "useradd",
    async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
      const username = positionals(args, new Set(["-s", "-g", "-G", "-u", "-d"]))[0];
      if (!username) return fail("useradd: missing operand");
      if (state.users.has(username)) {
        return fail(`useradd: user '${username}' already exists`, 9);
      }
      // useradd creates a primary group named after the user.
      state.users.set(username, { group: username });
      state.groups.set(username, new Set([username]));
      if (args.includes("-m")) {
        await ctx.fs.mkdir(`/home/${username}`, { recursive: true });
      }
      return ok();
    },
  );

  const groupadd = defineCommand("groupadd", async (args: string[]): Promise<ExecResult> => {
    const groupname = positionals(args, new Set(["-g"]))[0];
    if (!groupname) return fail("groupadd: missing operand");
    if (state.groups.has(groupname)) {
      return fail(`groupadd: group '${groupname}' already exists`, 9);
    }
    state.groups.set(groupname, new Set());
    return ok();
  });

  const usermod = defineCommand("usermod", async (args: string[]): Promise<ExecResult> => {
    // usermod -aG <group> <user>
    const rest = positionals(args, new Set());
    const [groupname, username] = rest;
    const members = groupname ? state.groups.get(groupname) : undefined;
    if (!members) {
      return fail(`usermod: group '${groupname}' does not exist`, 6);
    }
    if (!username || !exists(username)) {
      return fail(`usermod: user '${username}' does not exist`, 6);
    }
    members.add(username);
    return ok();
  });

  const gpasswd = defineCommand("gpasswd", async (args: string[]): Promise<ExecResult> => {
    // gpasswd -d <user> <group>
    const rest = positionals(args, new Set());
    const [username, groupname] = rest;
    const members = groupname ? state.groups.get(groupname) : undefined;
    if (!members) {
      return fail(`gpasswd: group '${groupname}' does not exist`, 1);
    }
    if (!username || !members.has(username)) {
      return fail(`gpasswd: user '${username}' is not a member of '${groupname}'`, 3);
    }
    members.delete(username);
    return ok();
  });

  // just-bash has no real ownership; chown is accepted as a no-op so the SDK's
  // exitCode checks pass. `chmod` is provided natively by just-bash.
  const chown = defineCommand("chown", async (): Promise<ExecResult> => ok());

  return [id, useradd, groupadd, usermod, gpasswd, chown];
}
