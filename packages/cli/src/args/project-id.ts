import * as cmd from "cmd-ts";

export const project = cmd.option({
  long: "project",
  type: { ...cmd.optional(cmd.string), displayName: "my-project" },
  description: "The project name or ID to associate with the command",
});

export const team = cmd.option({
  long: "team",
  type: { ...cmd.optional(cmd.string), displayName: "my-team" },
  description: "The team to associate with the command",
});
