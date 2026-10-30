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

describe("policy additions", () => {
  const readBounds = vi.fn().mockResolvedValue({ status: "known", bounds: [] });

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
    await expect(
      runManagedCredentialsFlow({
        initial: resolved(),
        managedOptions,
        context: baseContext({ interactive: true, input, output, reresolve }),
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled" } });
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
