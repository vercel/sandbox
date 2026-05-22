import * as cmd from "cmd-ts";
import chalk from "chalk";

export const publishPorts = cmd.multioption({
  long: "publish-port",
  short: "p",
  description: "Publish sandbox port(s) to DOMAIN.vercel.run",
  type: cmd.array(
    cmd.extendType(cmd.number, {
      displayName: "PORT",
      async from(number) {
        if (!Number.isInteger(number) || number < 1024 || number > 65535) {
          throw new Error(
            [
              `Invalid port: ${number}.`,
              `${chalk.bold("hint:")} Ports must be integers between 1024-65535 (privileged ports 0-1023 are reserved).`,
              "Examples: 3000, 8443",
            ].join("\n"),
          );
        }
        return number;
      },
    }),
  ),
});
