import * as cmd from "cmd-ts";
import {
  getAuth,
  updateAuthConfig,
  OAuth,
} from "@vercel/sandbox/dist/auth/index.js";
import { output } from "../util/output";
import chalk from "chalk";
import createDebugger from "debug";

const debug = createDebugger("sandbox:logout");

export const logout = cmd.command({
  name: "logout",
  description: "Log out of the Sandbox CLI",
  args: {},
  async handler() {
    const auth = getAuth();

    if (!auth?.token) {
      output.print(
        [
          `No active session found. You are not currently logged in.`,
          `${chalk.bold("hint:")} To log in, run: \`sandbox login\``,
        ].join("\n"),
      );
      return;
    }

    const oauth = await OAuth();
    await oauth.revokeToken(auth.token);
    updateAuthConfig({});
    debug("Configuration has been deleted");
    output.print("Logged out!");
  },
});
