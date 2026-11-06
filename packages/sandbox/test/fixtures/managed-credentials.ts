import { PassThrough } from "node:stream";

// Build raw objects without validating or normalizing inputs under test.
export const credentialGroup = <R, A, I>(
  repositories: R,
  actions: A,
  actAs?: I,
) => ({
  repositories,
  actions,
  ...(actAs === undefined ? {} : { actAs }),
});
export const configuration = <G, S>(github: G, source?: S) => ({
  ...(source === undefined ? {} : { source }),
  credentials: { github },
});

/** Feed one answer per prompt and capture all output. */
export function scriptedInput(answers: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  let index = 0;
  output.on("data", (chunk: Buffer) => {
    const part = chunk.toString();
    text += part;
    if (
      (part.includes("? ") || part.endsWith(": ")) &&
      index < answers.length
    ) {
      const answer = answers[index++];
      setImmediate(() => input.write(`${answer}\n`));
    }
  });
  return { input, output, text: () => text };
}
