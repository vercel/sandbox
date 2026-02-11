import pkg from "../package.json";

export const { version } = pkg;
export const packageName = pkg.name;

/**
 * Unicode symbol used to represent the CLI.
 */
export const logo = "▲";

/**
 * Returns the display name for the CLI header,
 * such as `Vercel Sandbox CLI`.
 */
export function getTitleName(): string {
  return "Vercel Sandbox CLI";
}
