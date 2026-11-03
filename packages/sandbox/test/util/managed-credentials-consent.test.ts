import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { promptReviewDecision } from "../../src/util/managed-credentials-review";
import { runManagedCredentialsFlow } from "../../src/util/managed-credentials-flow";
import { parseConfig } from "../../src/util/managed-credentials-config";
import { renderManagedCredentialsRetryCommand } from "../../src/util/managed-credentials-retry-command";

function io(answers: string[]) {
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

const config = parseConfig({
  source: { repo: "acme/widgets" },
  commitAs: { name: "Grace Hopper", email: "grace@example.com" },
  credentials: {
    github: [
      {
        repo: "acme/widgets",
        actions: ["git:write", "issues:read"],
        actAs: "42",
      },
    ],
  },
});
const initial = {
  config,
  origin: "flags" as const,
  originLabel: "command-line flags",
  provenance: {},
};

function run(answers: string[]) {
  const streams = io(answers);
  const bounds = vi.fn().mockResolvedValue(true);
  const renderCommand = () =>
    renderManagedCredentialsRetryCommand({
      config,
      team: "team_selected",
      project: "prj_selected",
      vcpus: 8,
      invocation: {
        appName: "sandbox",
        command: "create",
        args: [
          "--enable-github-credentials",
          "--token=secret-token",
          "--timeout=9m",
        ],
      },
    });
  const promise = runManagedCredentialsFlow({
    initial,
    context: {
      ...streams,
      team: "team_selected",
      project: "prj_selected",
      vcpus: 8,
      vcpusExplicit: true,
      interactive: true,
      json: false,
      yes: false,
      dryRun: false,
      hasProjectBounds: bounds,
      renderCommand,
    },
  });
  return { streams, bounds, promise };
}

describe("binary creation consent", () => {
  test("prints exactly the y/n prompt and no edit menu", async () => {
    const streams = io(["n"]);
    await expect(promptReviewDecision(streams)).resolves.toEqual({
      action: "cancel",
    });
    expect(streams.text()).toBe("Create this sandbox? (y/n) ");
  });

  test.each(["y", "Y", "yes", " YES "])(
    "accepts only an affirmative answer: %j",
    async (answer) => {
      const streams = io([answer]);
      await expect(promptReviewDecision(streams)).resolves.toEqual({
        action: "create",
      });
    },
  );

  test.each(["n", "no", "", "e", "edit", "c", "create", "other"])(
    "rejects without editing: %j",
    async (answer) => {
      // The second answer lets the old edit menu finish, proving its removal without a timeout.
      const streams = io([answer, "n"]);
      await expect(promptReviewDecision(streams)).resolves.toEqual({
        action: "cancel",
      });
      expect(streams.text()).not.toContain("Which value");
    },
  );

  test("n prints every explicit credential flag and preserves unrelated options", async () => {
    const { streams, bounds, promise } = run(["n"]);
    await expect(promise).rejects.toMatchObject({
      options: { reason: "canceled", exitCode: 130 },
    });
    const text = streams.text();
    for (const flag of [
      "--scope=team_selected",
      "--project=prj_selected",
      "--vcpus=8",
      "--timeout=9m",
      "--credentials-github-repo=acme/widgets",
      "--credentials-github-action=github:issues:read",
      "--credentials-github-act-as=42",
      "--credentials-github-commit-as=Grace Hopper <grace@example.com>",
    ])
      expect(text).toContain(flag);
    expect(text).not.toContain("--yes");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("Which value");
    expect(bounds).not.toHaveBeenCalled();
  });

  test.each(["EOF", "SIGINT"])(
    "%s cancels and prints the complete command",
    async (event) => {
      const { streams, bounds, promise } = run([]);
      if (event === "SIGINT") Object.assign(streams.output, { isTTY: true });
      streams.output.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Create this sandbox? (y/n)"))
          setImmediate(() =>
            event === "EOF"
              ? streams.input.end()
              : streams.input.write("\u0003"),
          );
      });
      await expect(promise).rejects.toMatchObject({
        options: { reason: "canceled", exitCode: 130 },
      });
      expect(streams.text()).toContain(
        "--credentials-github-action=github:issues:read",
      );
      expect(bounds).not.toHaveBeenCalled();
    },
  );

  test("y approves the exact proposal without changing scope or permissions", async () => {
    const { streams, bounds, promise } = run(["y"]);
    await expect(promise).resolves.toMatchObject({
      config,
      team: "team_selected",
      project: "prj_selected",
    });
    expect(bounds).toHaveBeenCalledExactlyOnceWith({
      team: "team_selected",
      project: "prj_selected",
    });
    expect(streams.text()).not.toContain("Edit this command");
  });
});
