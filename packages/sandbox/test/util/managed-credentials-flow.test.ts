import { describe, expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";
import { runManagedCredentialsFlow } from "../../src/util/managed-credentials-flow";
import { parseConfig } from "../../src/util/managed-credentials-config";
import type { ResolvedManagedCredentials } from "../../src/util/managed-credentials-resolve";
import { CliError } from "../../src/util/cli-error";

const configFor = (repo = "vercel/api") =>
  parseConfig({
    source: { repo },
    commitAs: { name: "Jack Jackson", email: "scubbojj@gmail.com" },
    credentials: {
      github: [
        {
          repo,
          actions: ["issues:read", "git:write"],
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
    commitAs: "git-config",
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
  vcpus: 6,
  vcpusExplicit: false,
  interactive: false,
  json: false,
  yes: false,
  dryRun: false,
  output: new PassThrough(),
  ...overrides,
});

describe("--yes review output", () => {
  test.each([
    { interactive: false, dryRun: false },
    { interactive: true, dryRun: false },
    { interactive: false, dryRun: true },
    { interactive: true, dryRun: true },
  ])(
    "omits guessed parameters (interactive: $interactive, dry-run: $dryRun)",
    async ({ interactive, dryRun }) => {
      const output = new PassThrough();
      const chunks: string[] = [];
      output.on("data", (chunk) => chunks.push(chunk.toString()));
      const hasProjectBounds = vi.fn().mockResolvedValue(true);
      const result = await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          yes: true,
          interactive,
          dryRun,
          output,
          hasProjectBounds,
        }),
      });
      expect(result.config).toEqual(configFor());
      expect(chunks.join("")).toBe("");
      expect(hasProjectBounds).toHaveBeenCalledTimes(dryRun ? 0 : 1);
    },
  );

  test("keeps project-wide policy warnings without printing the parameter review", async () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk) => chunks.push(chunk.toString()));
    await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({
        yes: true,
        output,
        readBounds: vi
          .fn()
          .mockResolvedValue({
            status: "known",
            bounds: [{ repo: "other/repository", actions: ["git:read"] }],
          }),
      }),
    });
    const text = chunks.join("");
    expect(text).toContain("raises the project-wide ceiling");
    expect(text).not.toContain("Managed credentials for this sandbox");
    expect(text).not.toContain("Setting");
    expect(text).not.toContain("vercel/api");
    expect(text).not.toContain("shown above");
  });

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
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({ yes: true }),
    });
    expect(result.config).toEqual(configFor());
  });

  test("a dry run returns without approval and without policy changes", async () => {
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({ dryRun: true }),
    });
    expect(result.boundsApproved).toBe(false);
  });

  test("JSON mode does not write the review to the output stream", async () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({ json: true, yes: true, output }),
    });
    expect(chunks.join("")).toBe("");
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
      const result = await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ interactive: true, ...io, hasProjectBounds }),
      });
      expect(result.config).toEqual(configFor());
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
      const readBounds = vi.fn().mockResolvedValue(undefined);
      const result = await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          interactive,
          yes: true,
          ...io,
          hasProjectBounds,
          readBounds,
        }),
      });
      expect(result.config).toEqual(configFor());
      expect(result.missingBounds).toEqual([]);
      expect(result.boundsApproved).toBe(false);
      expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
        team: "jacks-projects",
        project: "api",
      });
      expect(readBounds).toHaveBeenCalledExactlyOnceWith({
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

  test("JSON --yes emits a structured warning without extra plain text", async () => {
    const io = capture([]);
    const stdout = vi.spyOn(process.stdout, "write");
    try {
      await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          yes: true,
          json: true,
          ...io,
          hasProjectBounds: vi.fn().mockResolvedValue(false),
        }),
      });
      expect(io.text().trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(io.text())).toMatchObject({
        status: "warning",
        reason: "project_has_no_bounds",
        message: expect.stringContaining(
          "The Sandbox still receives only the requested rights",
        ),
        team: "jacks-projects",
        project: "api",
      });
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
    }
  });

  test("JSON --yes defaults to one warning on stderr and leaves stdout untouched", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, "write");
    try {
      await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          yes: true,
          json: true,
          output: undefined,
          hasProjectBounds: vi.fn().mockResolvedValue(false),
        }),
      });
      expect(stderr).toHaveBeenCalledOnce();
      expect(JSON.parse(String(stderr.mock.calls[0][0]))).toMatchObject({
        status: "warning",
        reason: "project_has_no_bounds",
        message: expect.stringContaining("no project-wide limit"),
        team: "jacks-projects",
        project: "api",
      });
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  test.each([false, true])(
    "dry-run does not perform the post-approval Bounds lookup (yes: %j)",
    async (yes) => {
      const hasProjectBounds = vi.fn();
      await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ dryRun: true, yes, hasProjectBounds }),
      });
      expect(hasProjectBounds).not.toHaveBeenCalled();
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

  test.each(["EOF", "SIGINT"])(
    "cancels with the full retry command on %s at the second prompt",
    async (event) => {
      const io = capture(["y"]);
      // A terminal-like stream exercises readline's SIGINT event without sending
      // a signal to the test process.
      if (event === "SIGINT") Object.assign(io.output, { isTTY: true });
      io.output.on("data", (chunk: Buffer) => {
        if (chunk.toString() === "Continue without project Bounds? (y/N) ") {
          setImmediate(() => {
            if (event === "EOF") io.input.end();
            else io.input.write("\u0003");
          });
        }
      });
      const command =
        "sandbox create --scope=jacks-projects --project=api --credentials-github-repo=vercel/api --credentials-github-actions=issues:read,git:write --credentials-github-act-as=@scubbo --credentials-github-commit-as='Jack Jackson <scubbojj@gmail.com>'";
      const renderCommand = vi.fn().mockReturnValue(command);
      const hasProjectBounds = vi.fn().mockResolvedValue(false);
      await expect(
        runManagedCredentialsFlow({
          initial: resolved(),
          context: baseContext({
            interactive: true,
            ...io,
            hasProjectBounds,
            renderCommand,
          }),
        }),
      ).rejects.toMatchObject({
        options: { reason: "canceled", exitCode: 130, data: { command } },
      });
      expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
        team: "jacks-projects",
        project: "api",
      });
      expect(renderCommand).toHaveBeenCalledExactlyOnceWith({
        config: configFor(),
        team: "jacks-projects",
        project: "api",
      });
      expect(io.text()).toContain(command);
    },
  );
});

describe("policy additions", () => {
  const readBounds = vi.fn().mockResolvedValue({
    status: "known",
    bounds: [{ repo: "other/repo", actions: [] }],
  });

  test("reports missing bounds and requires explicit approval", async () => {
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ readBounds }),
      }),
    ).rejects.toThrow(/raise the project-wide ceiling/);
  });

  test("--yes covers the displayed policy additions", async () => {
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({ readBounds, yes: true }),
    });
    expect(result.boundsApproved).toBe(true);
    expect(result.missingBounds).toEqual([
      {
        repo: "vercel/api",
        actions: ["github:issues:read", "git:write"],
      },
    ]);
  });

  test("proposes nothing when there is no policy source to read", async () => {
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({
        yes: true,
        readBounds: vi.fn().mockResolvedValue(undefined),
      }),
    });
    expect(result.missingBounds).toEqual([]);
    expect(result.boundsApproved).toBe(false);
  });

  test("refuses to propose additions from an unreadable policy", async () => {
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          yes: true,
          readBounds: vi
            .fn()
            .mockResolvedValue({ status: "unknown", reason: "HTTP 503" }),
        }),
      }),
    ).rejects.toThrow(/does not treat an unreadable policy as empty/);
  });
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
        options: { reason: "canceled", exitCode: 130, data: { command } },
      });
      expect(renderCommand).toHaveBeenCalledExactlyOnceWith({
        config: configFor(),
        team: "jacks-projects",
        project: "api",
      });
      expect(chunks.join("")).toContain(
        `Edit this command and run it again:\n\n${command}\n`,
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

  test("includes the explicit command in machine-readable consent errors", async () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const command = "sandbox create --credentials-github-repo=vercel/api";
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({
          json: true,
          output,
          renderCommand: () => command,
        }),
      }),
    ).rejects.toMatchObject({
      options: {
        reason: "confirmation_required",
        json: true,
        data: { command },
      },
    });
    expect(chunks.join("")).toBe("");
  });

  test.each([{ yes: true }, { dryRun: true }])(
    "does not render a rejected command on success: %j",
    async (mode) => {
      const renderCommand = vi.fn();
      await runManagedCredentialsFlow({
        initial: resolved(),
        context: baseContext({ ...mode, renderCommand }),
      });
      expect(renderCommand).not.toHaveBeenCalled();
    },
  );

  test("creating approves the proposal", async () => {
    const { input, output } = scripted(["y"]);
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      context: baseContext({ interactive: true, input, output }),
    });
    expect(result.config).toEqual(configFor());
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
    const result = await runManagedCredentialsFlow({
      initial,
      context: baseContext({
        dryRun: true,
        output,
        scopeProvenance: {
          team: "from .vercel/project.json",
          project: "from .vercel/project.json",
        },
      }),
    });
    const text = chunks.join("");
    expect(text).toMatch(/Team\s+jacks-projects\s+from \.vercel\/project.json/);
    expect(text).toMatch(/API actor\s+@scubbo/);
    expect(text).not.toContain("2373726");
    expect(result.config.credentials.github[0].actAs).toBe("2373726");
  });
});
