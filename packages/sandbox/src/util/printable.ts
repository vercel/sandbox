/**
 * Removes control characters from text that the CLI did not write, such as a
 * team or project read from a checkout or the API, so that a crafted value
 * cannot rewrite the terminal or add lines to the output.
 */
export function printable(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}
