/**
 * How this CLI was invoked: `sandbox` when it was installed on its own, or
 * `vercel sandbox` when it is the copy bundled inside the Vercel CLI.
 *
 * Recorded once while the command tree is built, so output far from the command
 * definitions can be tailored without every command threading the name through.
 * `app()` sets it for both entry points: the standalone binary calls `app()`
 * with no options, and the Vercel CLI calls `createApp({ appName: "vercel
 * sandbox" })`.
 */
let invokedAs = "sandbox";

export function setInvokedAs(appName: string): void {
  invokedAs = appName;
}

export function getInvokedAs(): string {
  return invokedAs;
}

/**
 * Whether we are running as the copy bundled inside the Vercel CLI, where this
 * package is a pinned dependency rather than something the user installed.
 *
 * The distinction matters for update advice: a bundled copy cannot be upgraded
 * on its own, so `npm i -g sandbox@latest` would install a second, standalone
 * CLI and leave `vercel sandbox` on the pinned version.
 *
 * Defaults to the recorded invocation; the parameter exists for tests.
 */
export function isVercelCliInvocation(name: string = invokedAs): boolean {
  return name.split(" ")[0] === "vercel";
}
