/**
 * Quotes one argument for a command that the CLI prints for a person to run.
 * The argument can hold text from outside the CLI, such as a team or project
 * read from a checkout's `.vercel/project.json`, so it must reach the shell
 * as data and never as syntax.
 */
export function shellQuote(argument: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)) {
    return argument;
  }
  if (/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/.test(argument)) {
    // Octal bytes keep control and direction-changing characters out of the
    // terminal. Bash and zsh read this form back to the same bytes.
    return `$'${Array.from(
      Buffer.from(argument, "utf8"),
      (byte) => `\\${byte.toString(8).padStart(3, "0")}`,
    ).join("")}'`;
  }
  return `'${argument.replaceAll("'", "'\\''")}'`;
}
