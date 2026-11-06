import {
  configuration,
  credentialGroup,
} from "../fixtures/managed-credentials";
import {
  captureOutput,
  scriptedInput as scripted,
} from "../fixtures/managed-credentials";
import { describe, expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";
import { runManagedCredentialsFlow } from "../../src/util/managed-credentials-flow";
import { parseConfig } from "../../src/util/managed-credentials-config";
import type { ResolvedManagedCredentials } from "../../src/util/managed-credentials-resolve";
import { CliError } from "../../src/util/cli-error";

const configFor = (repo = "vercel/api") =>
  parseConfig(
    configuration(
      [credentialGroup([repo], ["github:issues:read", "git:write"], "@scubbo")],
      { type: "git", url: `https://github.com/${repo}.git` },
    ),
  );

const resolved = (repo = "vercel/api"): ResolvedManagedCredentials => ({
  config: configFor(repo),
  origin: "flags",
  originLabel: "command-line flags",
  provenance: {
    repository: "git-remote",
    actor: "gh",
  },
});

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

const runFlow = (
  overrides: Record<string, unknown> = {},
  initial = resolved(),
) => runManagedCredentialsFlow({ initial, context: baseContext(overrides) });

describe("--yes review output", () => {
  test.each([false, true])(
    "omits guessed parameters (interactive: %s)",
    async (interactive) => {
      const captured = captureOutput();
      const { output } = captured;
      const hasProjectBounds = vi.fn().mockResolvedValue(true);
      await runFlow({
        yes: true,
        interactive,
        output,
        hasProjectBounds,
      });
      expect(captured.text()).toBe("");
      expect(hasProjectBounds).toHaveBeenCalledTimes(1);
    },
  );

  test("an unreadable project policy still stops --yes without a parameter dump", async () => {
    const captured = captureOutput();
    const { output } = captured;
    const hasProjectBounds = vi
      .fn()
      .mockRejectedValue(
        new CliError("Cannot read Bounds", { reason: "policy_unknown" }),
      );
    await expect(
      runFlow({ yes: true, output, hasProjectBounds }),
    ).rejects.toMatchObject({ options: { reason: "policy_unknown" } });
    expect(captured.text()).toBe("");
    expect(hasProjectBounds).toHaveBeenCalledExactlyOnceWith({
      team: "jacks-projects",
      project: "api",
    });
  });
});

describe("unbounded project confirmation", () => {
  test.each(["n", "", "c", "create", "sure"])(
    "requires separate approval after the initial yes: %j",
    async (answer) => {
      const io = scripted(["y", answer]);
      const hasProjectBounds = vi.fn().mockResolvedValue(false);
      await expect(
        runFlow({ interactive: true, ...io, hasProjectBounds }),
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
      const io = scripted(["y", answer]);
      const hasProjectBounds = vi.fn().mockResolvedValue(false);
      await runFlow({ interactive: true, ...io, hasProjectBounds });
      expect(io.text()).toContain("Continue without project Bounds? (y/N)");
    },
  );

  test("configured Bounds do not add a second prompt", async () => {
    const io = scripted(["y"]);
    const hasProjectBounds = vi.fn().mockResolvedValue(true);
    await runFlow({ interactive: true, ...io, hasProjectBounds });
    expect(hasProjectBounds).toHaveBeenCalledOnce();
    expect(io.text()).not.toContain("Continue without project Bounds");
  });

  test("rejecting the original proposal does not look up Bounds", async () => {
    const io = scripted(["n"]);
    const hasProjectBounds = vi.fn();
    await expect(
      runFlow({ interactive: true, ...io, hasProjectBounds }),
    ).rejects.toMatchObject({ options: { reason: "canceled", exitCode: 130 } });
    expect(hasProjectBounds).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "--yes accepts both confirmations but still prints the warning (interactive: %j)",
    async (interactive) => {
      const io = scripted([]);
      const hasProjectBounds = vi.fn().mockResolvedValue(false);
      await runFlow({
        interactive,
        yes: true,
        ...io,
        hasProjectBounds,
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
    await expect(runFlow({ hasProjectBounds })).rejects.toMatchObject({
      options: { reason: "confirmation_required" },
    });
    expect(hasProjectBounds).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "unreadable Bounds fail closed after approval (yes: %j)",
    async (yes) => {
      const io = scripted(yes ? [] : ["y"]);
      const error = new CliError("Cannot read Bounds", {
        reason: "policy_unknown",
      });
      await expect(
        runFlow({
          interactive: true,
          yes,
          ...io,
          hasProjectBounds: vi.fn().mockRejectedValue(error),
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
      const captured = scripted([answer]);
      const { input, output } = captured;
      const command =
        "sandbox create --scope=team --project=project --credentials-github-repo=vercel/api";
      const renderCommand = vi.fn().mockReturnValue(command);
      await expect(
        runFlow({
          interactive: true,
          input,
          output,
          renderCommand,
        }),
      ).rejects.toMatchObject({
        options: { reason: "canceled", exitCode: 130 },
      });
      expect(renderCommand).toHaveBeenCalledExactlyOnceWith(configFor());
      expect(captured.text()).toContain(
        `Re-add other creation options if needed.\n\n${command}\n`,
      );
    },
  );

  test("prints a recovery command when the input closes", async () => {
    const input = new PassThrough();
    const captured = captureOutput();
    const { output } = captured;
    output.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("(y/n)")) setImmediate(() => input.end());
    });
    const command = "sandbox create --credentials-github-repo=vercel/api";
    await expect(
      runFlow({
        interactive: true,
        input,
        output,
        renderCommand: () => command,
      }),
    ).rejects.toMatchObject({ options: { reason: "canceled", exitCode: 130 } });
    expect(captured.text()).toContain(command);
  });

  test("prints the explicit command for non-interactive consent errors", async () => {
    const captured = captureOutput();
    const { output } = captured;
    const command = "sandbox create --credentials-github-repo=vercel/api";
    await expect(
      runFlow({
        output,
        renderCommand: () => command,
      }),
    ).rejects.toMatchObject({
      options: {
        reason: "confirmation_required",
      },
    });
    expect(captured.text()).toContain(command);
  });

  test("does not render a rejected command on success", async () => {
    const renderCommand = vi.fn();
    await expect(
      runFlow({ yes: true, renderCommand }),
    ).resolves.toBeUndefined();
    expect(renderCommand).not.toHaveBeenCalled();
  });

  test("creating approves the proposal", async () => {
    const { input, output } = scripted(["y"]);
    await expect(
      runFlow({ interactive: true, input, output }),
    ).resolves.toBeUndefined();
  });
});

describe("review display metadata", () => {
  test("carries scope sources and usernames through the real flow without changing IDs", async () => {
    const initial = resolved();
    initial.config.credentials.github[0].actAs = "2373726";
    initial.actor = { actAs: "2373726", login: "scubbo", source: "gh" };
    const captured = captureOutput();
    const { output } = captured;
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
    const text = captured.text();
    expect(text).toMatch(/Team\s+jacks-projects\s+from \.vercel\/project.json/);
    expect(text).toMatch(/GitHub actor\s+@scubbo/);
    expect(text).not.toContain("2373726");
    expect(initial.config.credentials.github[0].actAs).toBe("2373726");
  });
});
