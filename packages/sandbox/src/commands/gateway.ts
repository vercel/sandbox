import * as cmd from "cmd-ts";
import { scope } from "../args/scope";
import { resolveGatewayKey } from "../util/agent-gateway/credentials";

export const gateway = cmd.subcommands({
  name: "gateway",
  description: "Set up a reusable key for create --ai --use-gateway-key",
  cmds: {
    setup: cmd.command({
      name: "setup",
      description:
        "Create or replace this user and team's securely stored Gateway key",
      args: { scope },
      async handler({ scope }) {
        await resolveGatewayKey(scope, { setup: true });
      },
    }),
  },
});
