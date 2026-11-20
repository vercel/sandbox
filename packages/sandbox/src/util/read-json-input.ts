import { readFile } from "node:fs/promises";
import { fail } from "./fail";

export interface JsonInputDescription {
  /** The option that names the file, such as `--network-policy-file`. */
  option: string;
  /** What the file holds, as it reads in a sentence, such as `network policy`. */
  subject: string;
  /** The verb that agrees with the subject. */
  verb: "is" | "are";
  /** The expected shape, shown when the content is not valid JSON. */
  shapeHint: string;
}

async function readStdin({
  option,
  subject,
}: JsonInputDescription): Promise<string> {
  if (process.stdin.isTTY) {
    fail(
      `${option} - reads stdin, but stdin is a terminal.`,
      `Pipe the ${subject} in, for example with a heredoc: ${option} - <<EOF.`,
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Reads JSON from a file, or from stdin when `path` is `-`. Errors name the
 * source and the position of a problem, never the content, because the input
 * can hold credentials.
 */
export async function readJsonInput(
  path: string,
  description: JsonInputDescription,
  read: (path: string) => Promise<string> = (p) =>
    p === "-" ? readStdin(description) : readFile(p, "utf8"),
): Promise<{ json: unknown; source: string }> {
  const { subject, verb, shapeHint } = description;
  const source = path === "-" ? "stdin" : path;

  let text: string;
  try {
    text = await read(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === undefined) {
      throw error;
    }
    fail(
      `Cannot read the ${subject} file ${source} (${code}).`,
      "Pass a readable JSON file, or - to read stdin.",
    );
  }

  try {
    return { json: JSON.parse(text), source };
  } catch (error) {
    // Node's message quotes the input, so keep only the position.
    const message = String(error);
    const where = (/line \d+ column \d+/.exec(message) ??
      /position \d+/.exec(message))?.[0];
    fail(
      `The ${subject} in ${source} ${verb} not valid JSON${where ? ` (${where})` : ""}.`,
      shapeHint,
    );
  }
}
