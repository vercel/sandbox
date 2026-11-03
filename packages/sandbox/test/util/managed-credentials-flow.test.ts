import { describe, expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";
import { runManagedCredentialsFlow } from "../../src/util/managed-credentials-flow";
import { parseConfig } from "../../src/util/managed-credentials-config";
import type {
  ManagedCredentialsOptions,
  ResolvedManagedCredentials,
} from "../../src/util/managed-credentials-resolve";
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

const managedOptions: ManagedCredentialsOptions = {
  credentialsActions: [],
  enableManagedCredentials: true,
};

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
  reresolve: vi.fn().mockResolvedValue(resolved()),
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

describe("non-interactive consent", () => {
  test("refuses to create without --yes", async () => {
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext(),
      }),
    ).rejects.toMatchObject({
      options: { reason: "confirmation_required" },
    });
  });

  test("--yes approves without prompting", async () => {
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ yes: true }),
    });
    expect(result.config).toEqual(configFor());
  });

  test("a dry run returns without approval and without policy changes", async () => {
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
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
      managedOptions,
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
          managedOptions,
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
        managedOptions,
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
      managedOptions,
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
        managedOptions,
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
      const reresolve = vi.fn();
      const result = await runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext({
          interactive,
          yes: true,
          ...io,
          hasProjectBounds,
          readBounds,
          reresolve,
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
      expect(reresolve).not.toHaveBeenCalled();
      expect(io.text()).toContain("This project has no Bounds");
      expect(io.text()).toContain(
        "The Sandbox still receives only the rights shown above",
      );
      expect(io.text()).not.toContain("Continue without project Bounds?");
      expect(io.text()).not.toContain(
        "Create this sandbox, edit a value, or cancel?",
      );
    },
  );

  test("JSON --yes emits a structured warning without extra plain text", async () => {
    const io = capture([]);
    const stdout = vi.spyOn(process.stdout, "write");
    try {
      await runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
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
          "The Sandbox still receives only the rights shown above",
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
        managedOptions,
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
        managedOptions,
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
        managedOptions,
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
          managedOptions,
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
          managedOptions,
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

  test("checks the corrected scope and retains the editable cancellation command", async () => {
    const io = capture(["e", "team", "other-team", "other-project", "y", "n"]);
    const hasProjectBounds = vi.fn().mockResolvedValue(false);
    const renderCommand = vi
      .fn()
      .mockReturnValue(
        "sandbox create --scope=other-team --project=other-project",
      );
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext({
          interactive: true,
          ...io,
          hasProjectBounds,
          renderCommand,
        }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled" } });
    expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
      team: "other-team",
      project: "other-project",
    });
    expect(io.text()).toContain(
      "sandbox create --scope=other-team --project=other-project",
    );
  });

  test("approves the final corrected project after both confirmations", async () => {
    const io = capture(["e", "project", "other-project", "y", "y"]);
    const hasProjectBounds = vi.fn().mockResolvedValue(false);
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, ...io, hasProjectBounds }),
    });
    expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
      team: "jacks-projects",
      project: "other-project",
    });
    expect(result).toEqual({
      config: configFor(),
      team: "jacks-projects",
      project: "other-project",
      scopeOverrides: { project: "other-project" },
      missingBounds: [],
      boundsApproved: false,
    });
  });
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
        managedOptions,
        context: baseContext({ readBounds }),
      }),
    ).rejects.toThrow(/raise the project-wide ceiling/);
  });

  test("--yes covers the displayed policy additions", async () => {
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
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
      managedOptions,
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
        managedOptions,
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
          managedOptions,
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

  test("prints the corrected proposal rather than the original guess", async () => {
    const { input, output } = scripted([
      "e",
      "repository",
      "acme/widgets",
      "n",
    ]);
    const renderCommand = vi
      .fn()
      .mockReturnValue("sandbox create --credentials-github-repo=acme/widgets");
    const reresolve = vi.fn().mockResolvedValue(resolved("acme/widgets"));
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext({
          interactive: true,
          input,
          output,
          renderCommand,
          reresolve,
        }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled" } });
    expect(renderCommand).toHaveBeenCalledExactlyOnceWith({
      config: configFor("acme/widgets"),
      team: "jacks-projects",
      project: "api",
    });
  });

  test("prints a recovery command when the input closes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
      if (chunk.toString().includes("(c/e/N)")) setImmediate(() => input.end());
    });
    const command = "sandbox create --credentials-github-repo=vercel/api";
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
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

  test("does not invent a command for an incomplete corrected scope", async () => {
    const { input, output } = scripted(["e", "team", "other-team", "", "n"]);
    const renderCommand = vi.fn();
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext({
          interactive: true,
          input,
          output,
          renderCommand,
        }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled" } });
    expect(renderCommand).not.toHaveBeenCalled();
  });

  test("includes the explicit command in machine-readable consent errors", async () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const command = "sandbox create --credentials-github-repo=vercel/api";
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
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
        managedOptions,
        context: baseContext({ ...mode, renderCommand }),
      });
      expect(renderCommand).not.toHaveBeenCalled();
    },
  );

  test("creating approves the proposal", async () => {
    const { input, output } = scripted(["c"]);
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, input, output }),
    });
    expect(result.config).toEqual(configFor());
  });

  test("an empty answer cancels rather than creating", async () => {
    const { input, output } = scripted([""]);
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext({ interactive: true, input, output }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled", exitCode: 130 } });
  });

  test("cancelling happens before any write", async () => {
    const { input, output } = scripted(["n"]);
    const reresolve = vi.fn();
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext({
          interactive: true,
          input,
          output,
          reresolve,
        }),
      }),
    ).rejects.toThrow(CliError);
    expect(reresolve).not.toHaveBeenCalled();
  });

  test("editing the repository recomputes the proposal", async () => {
    const { input, output } = scripted([
      "e",
      "repository",
      "acme/widgets",
      "c",
    ]);
    const reresolve = vi.fn().mockResolvedValue(resolved("acme/widgets"));

    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, input, output, reresolve }),
    });

    // The corrected inputs are re-resolved rather than the old proposal being
    // patched, so dependent inference is redone.
    expect(reresolve).toHaveBeenCalledWith(
      expect.objectContaining({ credentialsRepo: "acme/widgets" }),
      expect.anything(),
    );
    expect(result.config.source?.repo).toBe("acme/widgets");
  });

  test("editing by menu number selects the same field", async () => {
    const { input, output } = scripted(["e", "3", "acme/widgets", "c"]);
    const reresolve = vi.fn().mockResolvedValue(resolved("acme/widgets"));
    await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, input, output, reresolve }),
    });
    expect(reresolve).toHaveBeenCalledWith(
      expect.objectContaining({ credentialsRepo: "acme/widgets" }),
      expect.anything(),
    );
  });

  test("editing the action set replaces the requested actions", async () => {
    const { input, output } = scripted([
      "e",
      "actions",
      "issues:read, pull-request:create",
      "c",
    ]);
    const reresolve = vi.fn().mockResolvedValue(resolved());
    await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, input, output, reresolve }),
    });
    expect(reresolve).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialsActions: ["issues:read", "pull-request:create"],
      }),
      expect.anything(),
    );
  });

  test("a team correction asks for a project and reports both", async () => {
    // Editing the team immediately asks for a project, because one linked for
    // the previous team must not survive the override.
    const { input, output } = scripted([
      "e",
      "team",
      "other-team",
      "other-project",
      "c",
    ]);
    const reresolve = vi.fn().mockResolvedValue(resolved());
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, input, output, reresolve }),
    });
    expect(reresolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ team: "other-team", project: "other-project" }),
    );
    expect(result.team).toBe("other-team");
    expect(result.project).toBe("other-project");
    // The caller must create in the corrected scope, not the original one.
    expect(result.scopeOverrides).toEqual({
      team: "other-team",
      project: "other-project",
    });
  });

  test("refuses to create while the corrected team has no project", async () => {
    // Answering the chained project prompt with nothing leaves no project to
    // create in, so "create" must not be accepted.
    const { input, output } = scripted([
      "e",
      "team",
      "other-team",
      "",
      "c",
      "n",
    ]);
    const reresolve = vi.fn().mockResolvedValue(resolved());
    const hasProjectBounds = vi.fn();
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext({
          interactive: true,
          input,
          output,
          reresolve,
          hasProjectBounds,
        }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled" } });
    expect(hasProjectBounds).not.toHaveBeenCalled();
  });

  test("waits for a replacement project before inference or policy reads", async () => {
    const { input, output } = scripted([
      "e",
      "team",
      "other-team",
      "",
      "e",
      "project",
      "other-project",
      "c",
    ]);
    const reresolve = vi.fn(async (_options, scope) => {
      if (scope.team && !scope.project) throw new Error("incomplete scope");
      return resolved();
    });
    const readBounds = vi.fn(async (scope) => {
      if (scope.project === "(not set)") throw new Error("invalid project");
      return { status: "known" as const, bounds: [] };
    });
    const hasProjectBounds = vi.fn().mockResolvedValue(true);
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({
        interactive: true,
        input,
        output,
        reresolve,
        readBounds,
        hasProjectBounds,
      }),
    });
    expect(result.scopeOverrides).toEqual({
      team: "other-team",
      project: "other-project",
    });
    expect(reresolve).toHaveBeenCalledTimes(1);
    expect(readBounds).toHaveBeenCalledTimes(2);
    expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
      team: "other-team",
      project: "other-project",
    });
  });
  test("an unedited scope reports no overrides", async () => {
    const { input, output } = scripted(["c"]);
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, input, output }),
    });
    expect(result.scopeOverrides).toEqual({});
  });

  test("an empty action list does not restore the defaults", async () => {
    // Treating it as "no override" would widen the request the user was
    // narrowing.
    const { input, output } = scripted(["e", "actions", " , ", "c"]);
    const reresolve = vi.fn();
    await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, input, output, reresolve }),
    });
    expect(reresolve).not.toHaveBeenCalled();
  });

  test("offers only scope corrections for a configuration file", async () => {
    // The direct flags cannot be combined with a file, so offering them would
    // build an input combination that is rejected outright.
    const chunks: string[] = [];
    const { input, output } = scripted(["e", "n"]);
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await runManagedCredentialsFlow({
      initial: {
        ...resolved(),
        origin: "file",
        originLabel: "configuration file config.json",
      },
      managedOptions: {
        credentialsActions: [],
        credentialsFromConfigFile: "config.json",
      },
      context: baseContext({ interactive: true, input, output }),
    }).catch(() => undefined);
    const menu = chunks.join("");
    expect(menu).toContain("team");
    expect(menu).not.toContain("repository");
    expect(menu).not.toContain("GitHub API actions");
  });

  test("the permission check is recomputed after an edit", async () => {
    const { input, output } = scripted([
      "e",
      "repository",
      "acme/widgets",
      "c",
    ]);
    const readBounds = vi
      .fn()
      .mockResolvedValue({ status: "known", bounds: [] });
    await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({
        interactive: true,
        input,
        output,
        yes: false,
        readBounds,
        reresolve: vi.fn().mockResolvedValue(resolved("acme/widgets")),
      }),
    }).catch(() => undefined);
    // Once for the first proposal, once after the correction.
    expect(readBounds.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("an empty correction leaves the proposal unchanged", async () => {
    const { input, output } = scripted(["e", "repository", "", "c"]);
    const reresolve = vi.fn();
    const result = await runManagedCredentialsFlow({
      initial: resolved(),
      managedOptions,
      context: baseContext({ interactive: true, input, output, reresolve }),
    });
    expect(reresolve).not.toHaveBeenCalled();
    expect(result.config.source?.repo).toBe("vercel/api");
  });
});
