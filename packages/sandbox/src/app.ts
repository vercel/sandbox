import { subcommands } from "cmd-ts";
import { create } from "./commands/create";
import * as Run from "./commands/run";
import { list } from "./commands/list";
import { exec } from "./commands/exec";
import { connect } from "./commands/connect";
import { stop } from "./commands/stop";
import { cp } from "./commands/cp";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { version } from "./pkg";
import { snapshot } from "./commands/snapshot";
import { snapshots } from "./commands/snapshots";
import { config } from "./commands/config";

export const app = (opts?: { withoutAuth?: boolean; appName?: string }) =>
  subcommands({
    name: opts?.appName ?? "sandbox",
    description: "Interfacing with Vercel Sandbox",
    version,
    cmds: {
      list,
      create,
      config,
      copy: cp,
      exec,
      connect,
      stop,
      run: Run.run,
      snapshot,
      snapshots,
      ...(!opts?.withoutAuth && {
        login,
        logout,
      }),
    },
  });
