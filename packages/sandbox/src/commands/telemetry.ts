import * as cmd from "cmd-ts";
import chalk from "chalk";
import {
  readTelemetryConfig,
  writeTelemetryConfig,
  telemetry,
} from "../telemetry";

function printStatus(): void {
  const enabled = telemetry.enabled;
  const status = enabled ? chalk.green("Enabled") : chalk.red("Disabled");
  process.stderr.write(`Telemetry status: ${status}\n\n`);
  if (enabled) {
    process.stderr.write(
      "The Vercel Sandbox CLI collects anonymous usage data to improve the product.\n" +
        `Opt out with ${chalk.cyan("sandbox telemetry disable")} or by setting ${chalk.cyan("VERCEL_SANDBOX_TELEMETRY_DISABLED=1")}.\n` +
        `Inspect what is collected by setting ${chalk.cyan("VERCEL_TELEMETRY_DEBUG=1")}; events are printed and not sent.\n`,
    );
  } else {
    process.stderr.write(
      `Re-enable with ${chalk.cyan("sandbox telemetry enable")}.\n`,
    );
  }
}

const statusCommand = cmd.command({
  name: "status",
  description: "Show whether telemetry collection is enabled",
  args: {},
  async handler() {
    printStatus();
  },
});

const enableCommand = cmd.command({
  name: "enable",
  description: "Enable telemetry collection",
  args: {},
  async handler() {
    writeTelemetryConfig(true);
    printStatus();
  },
});

const disableCommand = cmd.command({
  name: "disable",
  description: "Disable telemetry collection",
  args: {},
  async handler() {
    writeTelemetryConfig(false);
    printStatus();
  },
});

export const telemetryCommand = cmd.subcommands({
  name: "telemetry",
  description: "Manage telemetry collection status",
  cmds: {
    status: statusCommand,
    enable: enableCommand,
    disable: disableCommand,
  },
});
