import type { ManagedCredentialsConfig } from "../../src/util/managed-credentials-config";
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

export function captureOutput() {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  return { output, text: () => text };
}

/** Feed one answer per prompt and capture all output. */
export function scriptedInput(answers: string[]) {
  const input = new PassThrough();
  const captured = captureOutput();
  const { output } = captured;
  let index = 0;
  output.on("data", (chunk: Buffer) => {
    const part = chunk.toString();
    if (
      (part.includes("? ") || part.endsWith(": ")) &&
      index < answers.length
    ) {
      const answer = answers[index++];
      setImmediate(() => input.write(`${answer}\n`));
    }
  });
  return { input, ...captured };
}

export const apiConfiguration = (): ManagedCredentialsConfig => ({
  source: {
    depth: 2,
    type: "git" as const,
    url: "https://github.com/acme/Widgets",
    revision: "refs/heads/main",
  },
  credentials: {
    github: [
      {
        repositories: ["acme/Widgets", "acme/tools"],
        actions: [
          "github:pull-request:create",
          "git:write",
          "git:write-workflows",
        ],
        actAs: "@octocat",
      },
      {
        repositories: ["acme/Docs"],
        actions: ["github:issues:read"],
        actAs: "43",
      },
      {
        repositories: ["acme/Widgets"],
        actions: ["github:labels:read"],
        actAs: "@octocat",
      },
    ],
  },
});
