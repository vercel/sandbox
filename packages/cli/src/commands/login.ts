import * as cmd from "cmd-ts";
import chalk from "chalk";
import { output } from "../util/output";
import { default as open } from "open";
import ora from "ora";
import { acquireRelease } from "../util/disposables";
import { OAuth, pollForToken } from "@vercel/sandbox/dist/auth/index.js";
import createDebugger from "debug";

const debug = createDebugger("sandbox:login");

export const login = cmd.command({
  name: "login",
  description: "Log in to the Sandbox CLI",
  args: {},
  async handler() {
    using spinner = acquireRelease(
      () => ora("Creating device authorization request...").start(),
      (s) => s.stop(),
    );

    const oauth = await OAuth();
    const request = await oauth.deviceAuthorizationRequest();
    const { user_code, verification_uri, verification_uri_complete } = request;

    spinner.text = "Waiting for you to authenticate...";

    // If we're in a TTY, we can listen for ENTER keypresses to open the browser
    const subscribeToStdin = process.stdin.isTTY;

    using _returnListener = acquireRelease(
      () => {
        const callback = async (char: Buffer) => {
          if (char.toString() === "\r") {
            await open(verification_uri_complete);
          }
        };
        const beforeExit = () => {
          if (spinner.isSpinning) {
            spinner.fail("Authentication cancelled.");
          }
          process.off("SIGINT", beforeExit);
          process.emit("SIGINT");
        };
        if (subscribeToStdin) {
          process.stdin.on("data", callback);
          process.on("SIGINT", beforeExit);
        }
        return () => {
          process.stdin.off("data", callback);
          process.off("SIGINT", beforeExit);
        };
      },
      (unsubscribe) => unsubscribe(),
    );

    const verificationLink = output.link(
      verification_uri.replace("https://", ""),
      verification_uri_complete,
    );

    let text = `Visit ${chalk.bold(verificationLink)} and enter ${chalk.bold(user_code)}`;
    if (subscribeToStdin) {
      text += chalk.grey("\nℹ️ Press [ENTER] to open the browser");
    }

    spinner.text = `Waiting for authentication...\n${text}`;

    let error: Error | undefined;
    for await (const event of pollForToken({ request, oauth })) {
      switch (event._tag) {
        case "Timeout":
          debug(
            `Connection timeout. Slowing down, polling every ${event.newInterval / 1000}s...`,
          );
          break;
        case "SlowDown":
          debug(
            `Authorization server requests to slow down. Polling every ${event.newInterval / 1000}s...`,
          );
          break;
        case "Response":
          debug("Device Access Token response:", await event.response.text());
          break;
        case "Error":
          error = event.error;
          break;
        default:
          output.error(
            chalk.yellow(
              [
                `${chalk.bold("warn:")} unexpected polling event ignored.`,
                `├▶ event: ${JSON.stringify(event satisfies never)}`,
                `│  This indicates a version mismatch between CLI and SDK.`,
                `╰▶ ${chalk.bold("help:")} update @vercel/sandbox with \`npm update @vercel/sandbox\`.`,
                `   If this persists, report at https://github.com/vercel/vercel/issues`,
                `   with the above event details.`,
              ].join("\n"),
            ),
          );
      }
    }

    if (error) {
      spinner.fail(`${chalk.red("error:")} ${error.message}`);
      process.exitCode = 1;
    } else {
      spinner.succeed(
        `${chalk.cyan("Congratulations!")} You are now signed in.`,
      );
    }
  },
});
