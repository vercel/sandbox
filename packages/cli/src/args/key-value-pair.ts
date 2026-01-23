import * as cmd from "cmd-ts";
import chalk from "chalk";

export const KeyValuePair = cmd.extendType(cmd.string, {
  displayName: "key=value",
  async from(input) {
    if (!input.includes("=")) {
      // Punning: --env ABC is equivalent to --env ABC=$ABC
      return { key: input, value: process.env[input] };
    }

    const [key, ...rest] = input.split("=");
    return { key, value: rest.join("=") };
  },
});

export const ObjectFromKeyValue = cmd.extendType(cmd.array(KeyValuePair), {
  async from(input): Promise<Record<string, string>> {
    const obj: Record<string, string> = Object.create(null);
    const missingVars: string[] = [];
    for (const { key, value } of input) {
      if (value === undefined) {
        missingVars.push(key);
      } else {
        obj[key] = value;
      }
    }
    if (missingVars.length > 0) {
      const plural = missingVars.length > 1;
      console.error(
        chalk.yellow(
          [
            `${chalk.bold("warn:")} env var${plural ? "s were" : " was"} not defined and ${plural ? "were" : "was"} not passed: ${missingVars.join(", ")}`,
            `╰▶ ${chalk.bold("hint:")} --env VAR is equivalent to --env VAR=$VAR`,
          ].join("\n"),
        ),
      );
    }
    return obj;
  },
});
