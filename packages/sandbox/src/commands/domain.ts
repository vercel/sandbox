import * as cmd from "cmd-ts";
import { sandboxName } from "../args/sandbox-name";
import { scope } from "../args/scope";
import { sandboxClient } from "../client";

export const domain = cmd.command({
  name: "domain",
  description: "Print the public domain for a port in a running sandbox",
  args: {
    sandbox: cmd.positional({ type: sandboxName }),
    port: cmd.positional({
      type: cmd.number,
      description: "Published port number",
    }),
    scope,
  },
  async handler({ sandbox: name, port, scope: { token, team, project } }) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be an integer between 1 and 65535.");
    }
    const sandbox = await sandboxClient.get({
      name,
      projectId: project,
      teamId: team,
      token,
      resume: false,
    });
    if (sandbox.currentSession().status !== "running") {
      throw new Error(`Sandbox ${name} has no running session.`);
    }
    process.stdout.write(`${sandbox.domain(port)}\n`);
  },
});
