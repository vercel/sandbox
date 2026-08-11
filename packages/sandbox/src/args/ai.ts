import * as cmd from "cmd-ts";

export const ai = cmd.flag({
  long: "ai",
  description:
    "Expose AI Gateway credentials inside the sandbox so coding agents like `claude` work without any login or API keys. " +
    "Injects a short-lived OIDC token scoped to the sandbox's project.",
});
