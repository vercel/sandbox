import { describe, expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";
import { runManagedCredentialsFlow } from "../../src/util/managed-credentials-flow";
import { parseConfig } from "../../src/util/managed-credentials-config";
import type { ResolvedManagedCredentials } from "../../src/util/managed-credentials-resolve";
import { CliError } from "../../src/util/cli-error";

const configFor = (repo = "vercel/api") =>
  parseConfig({
    source: { type: "git", url: `https://github.com/${repo}.git` },
    commitAs: { name: "Jack Jackson", email: "scubbojj@gmail.com" },
    credentials: {
      github: [
        {
          repositories: [repo],
          actions: ["github:issues:read", "git:write"],
          actAs: "@scubbo",
        },
      ],
    },
  });

const resolved = (repo = "vercel/api"): ResolvedManagedCredentials => ({
  config: configFor(repo),
  origin: "flags",
  originLabel: "command-line flags",
  provenance: {
    repository: "git-remote",
    commitAs: "actor-derived",
    actor: "gh",
  },
});

/** Drive the flow with a scripted sequence of answers. */
function scripted(answers: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  let index = 0;
  // readline emits "line" per newline; queue the answers so each question is
  // answered in order without racing the prompt.
  const feed = () => {
    if (index < answers.length) {
      const answer = answers[index++];
      setImmediate(() => input.write(`${answer}\n`));
    }
  };
  output.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("? ") || text.endsWith(": ")) feed();
  });
  feed();
  return { input, output };
}

const baseContext = (overrides: Record<string, unknown> = {}) => ({
  team: "jacks-projects",
  project: "api",
  displayScope: { team: "jacks-projects", project: "api" },
  vcpus: 6,
  vcpusExplicit: false,
  interactive: false,
  yes: false,
  output: new PassThrough(),
  ...overrides,
});

describe("--yes review output", () => {
  test.each([false, true])(
    "omits guessed parameters (interactive: %s)",
    async (interactive) => {
      const output = new PassThrough();
      const chunks: string[] = [];
      output.on("data", (chunk) => chunks.push(chunk.toString()));
      const hasProjectBounds = vi.fn().mockResolvedValue(true);
      await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          yes: true,
          interactive,
          output,
          hasProjectBounds,
        }),
      });
      expect(chunks.join("")).toBe("");
      expect(hasProjectBounds).toHaveBeenCalledTimes(1);
    },
  );

  test("an unreadable project policy still stops --yes without a parameter dump", async () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk) => chunks.push(chunk.toString()));
    const hasProjectBounds = vi
      .fn()
      .mockRejectedValue(
        new CliError("Cannot read Bounds", { reason: "policy_unknown" }),
      );
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ yes: true, output, hasProjectBounds }),
      }),
    ).rejects.toMatchObject({ options: { reason: "policy_unknown" } });
    expect(chunks.join("")).toBe("");
    expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
      team: "jacks-projects",
      project: "api",
    });
  });
});

describe("non-interactive consent", () => {
  test("refuses to create without --yes", async () => {
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext(),
      }),
    ).rejects.toMatchObject({
      options: { reason: "confirmation_required" },
    });
  });

  test("--yes approves without prompting", async () => {
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ yes: true }),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("unbounded project confirmation", () => {
  function capture(answers: string[]) {
    const io = scripted(answers);
    const chunks: string[] = [];
    io.output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    return { ...io, text: () => chunks.join("") };
  }

  test.each(["n", "", "c", "create", "sure"])(
    "requires separate approval after the initial yes: %j",
    async (answer) => {
      const io = capture(["y", answer]);
      const hasProjectBounds = vi.fn().mockResolvedValue(false);
      await expect(
        runManagedCredentialsFlow({
          initial: resolved(),
          context: baseContext({ interactive: true, ...io, hasProjectBounds }),
        }),
      ).rejects.toMatchObject({
        options: { reason: "canceled", exitCode: 130 },
      });
      expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
        team: "jacks-projects",
        project: "api",
      });
      expect(io.text()).toContain("This project has no Bounds");
      expect(io.text()).toContain("no project-wide limit");
      expect(io.text()).toContain("Continue without project Bounds? (y/N)");
    },
  );

  test.each(["y", "yes", " YES "])(
    "two approvals accept an unbounded project: %j",
    async (answer) => {
      const io = capture(["y", answer]);
      const hasProjectBounds = vi.fn().mockResolvedValue(false);
      await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ interactive: true, ...io, hasProjectBounds }),
      });
      expect(io.text()).toContain("Continue without project Bounds? (y/N)");
    },
  );

  test("configured Bounds do not add a second prompt", async () => {
    const io = capture(["y"]);
    const hasProjectBounds = vi.fn().mockResolvedValue(true);
    await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({ interactive: true, ...io, hasProjectBounds }),
    });
    expect(hasProjectBounds).toHaveBeenCalledOnce();
    expect(io.text()).not.toContain("Continue without project Bounds");
  });

  test("rejecting the original proposal does not look up Bounds", async () => {
    const io = capture(["n"]);
    const hasProjectBounds = vi.fn();
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ interactive: true, ...io, hasProjectBounds }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled" } });
    expect(hasProjectBounds).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "--yes accepts both confirmations but still prints the warning (interactive: %j)",
    async (interactive) => {
      const io = capture([]);
      const hasProjectBounds = vi.fn().mockResolvedValue(false);
      await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          interactive,
          yes: true,
          ...io,
          hasProjectBounds,
        }),
      });
      expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
        team: "jacks-projects",
        project: "api",
      });
      expect(io.text()).toContain("This project has no Bounds");
      expect(io.text()).toContain(
        "The Sandbox still receives only the requested rights",
      );
      expect(io.text()).not.toContain("Continue without project Bounds?");
      expect(io.text()).not.toContain("Create this sandbox?");
      expect(io.text()).not.toContain("Managed credentials for this sandbox");
      expect(io.text()).not.toContain("Setting");
    },
  );

  test("noninteractive use without --yes does not look up Bounds", async () => {
    const hasProjectBounds = vi.fn();
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ hasProjectBounds }),
      }),
    ).rejects.toMatchObject({ options: { reason: "confirmation_required" } });
    expect(hasProjectBounds).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "unreadable Bounds fail closed after approval (yes: %j)",
    async (yes) => {
      const io = capture(yes ? [] : ["y"]);
      const error = new CliError("Cannot read Bounds", {
        reason: "policy_unknown",
      });
      await expect(
        runManagedCredentialsFlow({
          initial: resolved(),
          context: baseContext({
            interactive: true,
            yes,
            ...io,
            hasProjectBounds: vi.fn().mockRejectedValue(error),
          }),
        }),
      ).rejects.toBe(error);
      expect(io.text()).not.toContain("This project has no Bounds");
      expect(io.text()).not.toContain("Continue without project Bounds?");
    },
  );
});

describe("interactive review", () => {
  test.each(["n", ""])(
    "prints an editable command when rejecting with %j",
    async (answer) => {
      const { input, output } = scripted([answer]);
      const chunks: string[] = [];
      output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
      const command =
        "sandbox create --scope=team --project=project --credentials-github-repo=vercel/api";
      const renderCommand = vi.fn().mockReturnValue(command);
      await expect(
        runManagedCredentialsFlow({
          initial: resolved(),
          context: baseContext({
            interactive: true,
            input,
            output,
            renderCommand,
          }),
        }),
      ).rejects.toMatchObject({
        options: { reason: "canceled", exitCode: 130 },
      });
      expect(renderCommand).toHaveBeenCalledExactlyOnceWith(configFor());
      expect(chunks.join("")).toContain(
        `Re-add other creation options if needed.\n\n${command}\n`,
      );
    },
  );

  test("prints a recovery command when the input closes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunk.toString().includes("(y/n)")) setImmediate(() => input.end());
    });
    const command = "sandbox create --credentials-github-repo=vercel/api";
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          interactive: true,
          input,
          output,
          renderCommand: () => command,
        }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled", exitCode: 130 } });
    expect(chunks.join("")).toContain(command);
  });

  test("prints the explicit command for non-interactive consent errors", async () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const command = "sandbox create --credentials-github-repo=vercel/api";
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          output,
          renderCommand: () => command,
        }),
      }),
    ).rejects.toMatchObject({
      options: {
        reason: "confirmation_required",
      },
    });
    expect(chunks.join("")).toContain(command);
  });

  test("does not render a rejected command on success", async () => {
    const renderCommand = vi.fn();
    await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({ yes: true, renderCommand }),
    });
    expect(renderCommand).not.toHaveBeenCalled();
  });

  test("creating approves the proposal", async () => {
    const { input, output } = scripted(["y"]);
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ interactive: true, input, output }),
      }),
    ).resolves.toBeUndefined();
  });

  test("an empty answer cancels rather than creating", async () => {
    const { input, output } = scripted([""]);
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ interactive: true, input, output }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled", exitCode: 130 } });
  });
});

describe("review display metadata", () => {
  test("carries scope sources and usernames through the real flow without changing IDs", async () => {
    const initial = resolved();
    initial.config.credentials.github[0].actAs = "2373726";
    initial.actor = { actAs: "2373726", login: "scubbo", source: "gh" };
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const input = new PassThrough();
    output.on("data", (chunk) => {
      if (String(chunk).includes("Create this sandbox?"))
        setImmediate(() => input.write("n\n"));
    });
    await expect(
      runManagedCredentialsFlow({
        initial,
        context: baseContext({
          interactive: true,
          input,
          output,
          scopeProvenance: {
            team: "from .vercel/project.json",
            project: "from .vercel/project.json",
          },
        }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled" } });
    const text = chunks.join("");
    expect(text).toMatch(/Team\s+jacks-projects\s+from \.vercel\/project.json/);
    expect(text).toMatch(/GitHub actor\s+@scubbo/);
    expect(text).not.toContain("2373726");
    expect(initial.config.credentials.github[0].actAs).toBe("2373726");
  });
});
