import * as cmd from "cmd-ts";
import { describe, expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";
import { GITHUB_API_CREDENTIAL_ACTIONS } from "@vercel/sandbox";
import { managedCredentialOptions } from "../../src/args/managed-credentials";
import {
  hasManagedCredentialsRequest,
  resolveManagedCredentials,
  type ManagedCredentialsOptions,
} from "../../src/util/managed-credentials-resolve";
import { runManagedCredentialsFlow } from "../../src/util/managed-credentials-flow";
import { renderManagedCredentialsRetryCommand } from "../../src/util/managed-credentials-retry-command";
import { buildReview } from "../../src/util/managed-credentials-review";

type Access = "read" | "write";
const parser = cmd.command({
  name: "credentials",
  args: managedCredentialOptions,
  handler: (args) => args,
});
const readActions = [
  "github:pull-request:get",
  "github:issues:read",
  "github:labels:read",
  "github:ci-status:read",
];
const options = (
  githubAccess: Access,
  extra: Partial<ManagedCredentialsOptions> = {},
) => ({ credentialsActions: [], githubAccess, ...extra });
const context = () => ({
  token: "test-token",
  teamId: "team_review",
  inferRepositoryImpl: vi.fn().mockResolvedValue("acme/widgets"),
  inferCommitIdentityImpl: vi
    .fn()
    .mockResolvedValue({ name: "Grace Hopper", email: "grace@example.com" }),
  inferActorImpl: vi
    .fn()
    .mockResolvedValue({ actAs: "42", source: "gh" as const, login: "grace" }),
  loadFromSandbox: vi.fn().mockResolvedValue({ credentials: { github: [] } }),
});

function scripted(answers: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  let index = 0;
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

describe("GitHub access argument", () => {
  test.each(["read", "write"] as const)("accepts %s", async (level) => {
    expect(await cmd.run(parser, [`--github-access=${level}`])).toMatchObject({
      githubAccess: level,
    });
  });
  test.each(["read", "write"] as const)(
    "accepts a separate %s value",
    async (level) => {
      expect(await cmd.run(parser, ["--github-access", level])).toMatchObject({
        githubAccess: level,
      });
    },
  );
  test.each([
    { values: [] },
    { values: ["admin"] },
    { values: ["READ"] },
    { values: ["read,write"] },
    { values: ["read", "--github-access=write"] },
  ])("rejects missing, unknown, or repeated levels: %j", async ({ values }) => {
    expect(
      (await cmd.runSafely(parser, ["--github-access", ...values]))._tag,
    ).toBe("error");
  });
  test.each([
    "repo",
    "action",
    "commit-as",
    "act-as",
    "no-write",
    "from-config-file",
    "from-sandbox",
    "persist-configuration",
  ])("does not register the old credentials-%s name", async (flag) => {
    expect(
      (await cmd.runSafely(parser, [`--credentials-${flag}=value`]))._tag,
    ).toBe("error");
  });
});

describe("preset resolution", () => {
  test.each(["read", "write"] as const)(
    "%s opts in and selects an exact set for the inferred repository",
    async (level) => {
      const ctx = context();
      expect(hasManagedCredentialsRequest(options(level))).toBe(true);
      const result = await resolveManagedCredentials(options(level), ctx);
      expect(result?.config.source).toEqual({ repo: "acme/widgets" });
      expect(result?.config.credentials.github).toEqual([
        {
          repo: "acme/widgets",
          actions: [
            ...(level === "read" ? readActions : GITHUB_API_CREDENTIAL_ACTIONS),
            `git:${level}`,
          ],
          actAs: "42",
        },
      ]);
      expect(result?.config.credentials.github[0].actions).not.toContain(
        "git:write-workflows",
      );
      expect(ctx.inferRepositoryImpl).toHaveBeenCalledOnce();
      if (level === "read") {
        expect(result?.config.commitAs).toBeUndefined();
        expect(ctx.inferCommitIdentityImpl).not.toHaveBeenCalled();
      } else
        expect(result?.config.commitAs).toEqual({
          name: "Grace Hopper",
          email: "grace@example.com",
        });
      const rows = buildReview({
        config: result!.config,
        provenance: result!.provenance,
        originLabel: result!.originLabel,
        team: "team_review",
        project: "prj_review",
        vcpus: 6,
        vcpusExplicit: false,
        missingBounds: [],
      });
      expect(rows.find((row) => row.label === "Git access")?.note).toContain(
        `--github-access=${level}`,
      );
    },
  );

  test("an explicit repository still overrides repository inference", async () => {
    const ctx = context();
    const result = await resolveManagedCredentials(
      options("read", { credentialsRepo: "acme/other" }),
      ctx,
    );
    expect(result?.config.source?.repo).toBe("acme/other");
    expect(ctx.inferRepositoryImpl).not.toHaveBeenCalled();
  });

  test.each(["read", "write"] as const)(
    "rejects %s with explicit actions or complete configurations before inference",
    async (level) => {
      for (const extra of [
        { credentialsActions: ["issues:read"] },
        { credentialsFromConfigFile: "/missing/config.json" },
        { credentialsFromSandbox: "sbx_existing" },
        { credentialsNoWrite: true },
        { credentialsNoWrite: false },
      ]) {
        const ctx = context();
        await expect(
          resolveManagedCredentials(options(level, extra), ctx),
        ).rejects.toThrow(/--github-access/);
        expect(ctx.inferRepositoryImpl).not.toHaveBeenCalled();
        expect(ctx.inferActorImpl).not.toHaveBeenCalled();
        expect(ctx.loadFromSandbox).not.toHaveBeenCalled();
      }
    },
  );

  test("a read preset rejects explicit commit credit instead of widening Git access", async () => {
    await expect(
      resolveManagedCredentials(
        options("read", {
          credentialsCommitAs: "Grace Hopper <grace@example.com>",
        }),
        context(),
      ),
    ).rejects.toThrow(/read-only/);
  });

  test("an invalid raw level never falls through to write access", async () => {
    const ctx = context();
    await expect(
      resolveManagedCredentials(
        { ...options("read"), githubAccess: "admin" as never },
        ctx,
      ),
    ).rejects.toThrow(/--github-access/);
    expect(ctx.inferRepositoryImpl).not.toHaveBeenCalled();
  });
});

describe("review and command recovery", () => {
  test.each(["read", "write"] as const)(
    "a rejected %s command expands the preset into explicit flags",
    async (level) => {
      const resolved = await resolveManagedCredentials(
        options(level),
        context(),
      );
      const command = renderManagedCredentialsRetryCommand({
        config: resolved!.config,
        team: "team_review",
        project: "prj_review",
        vcpus: 6,
        invocation: {
          appName: "sandbox",
          command: "create",
          args: [`--github-access=${level}`],
        },
      });
      expect(command).not.toContain("--github-access");
      expect(command).toContain("--credentials-github-repo=acme/widgets");
      expect(command).toContain(
        "--credentials-github-action=github:issues:read",
      );
      expect(command.includes("--credentials-github-no-write")).toBe(
        level === "read",
      );
      expect(command).not.toContain("--yes");
    },
  );

  test.each(["read", "write"] as const)(
    "rejecting a %s preset prints the expanded permissions without another question",
    async (level) => {
      const initial = await resolveManagedCredentials(
        options(level),
        context(),
      );
      const io = scripted(["n"]);
      const chunks: string[] = [];
      io.output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
      await expect(
        runManagedCredentialsFlow({
          initial: initial!,
          context: {
            ...io,
            team: "team_review",
            project: "prj_review",
            vcpus: 6,
            vcpusExplicit: false,
            interactive: true,
            json: false,
            yes: false,
            dryRun: false,
            renderCommand: (proposal) =>
              renderManagedCredentialsRetryCommand({
                ...proposal,
                vcpus: 6,
                invocation: {
                  appName: "sandbox",
                  command: "create",
                  args: [`--github-access=${level}`],
                },
              }),
          },
        }),
      ).rejects.toMatchObject({
        options: { reason: "canceled", exitCode: 130 },
      });
      const text = chunks.join("");
      expect(text).toContain("--credentials-github-action=github:issues:read");
      expect(text.includes("--credentials-github-no-write")).toBe(
        level === "read",
      );
      expect(text).not.toContain("Which value");
      expect(text).not.toContain("--yes");
    },
  );
});
