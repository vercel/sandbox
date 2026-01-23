import { subcommands } from "cmd-ts";
import { create } from "./commands/create";
import * as Run from "./commands/run";
import { list } from "./commands/list";
import { exec } from "./commands/exec";
import { ssh } from "./commands/ssh";
import { stop } from "./commands/stop";
import { cp } from "./commands/cp";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { version } from "./pkg";
import { snapshot } from "./commands/snapshot";
import { snapshots } from "./commands/snapshots";

export const app = (opts?: { withoutAuth?: boolean; appName?: string }) =>
  subcommands({
    name: opts?.appName ?? "sandbox",
    description: "Interfacing with Vercel Sandbox",
    version,
    cmds: {
      list,
      create,
      copy: cp,
      exec,
      ssh,
      stop,
      run: Run.run,
      sh: Run.sh,
      snapshot,
      snapshots,
      ...(!opts?.withoutAuth && {
        login,
        logout,
      }),
    },
  });
