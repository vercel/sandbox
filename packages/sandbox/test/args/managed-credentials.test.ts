import * as cmd from "cmd-ts";
import { describe, expect, test } from "vitest";
import {
  managedCredentialOptions,
  executionOptions,
} from "../../src/args/managed-credentials";

const parser = cmd.command({
  name: "credentials",
  args: { ...managedCredentialOptions, ...executionOptions },
  handler: (args) => args,
});

describe("managed credential arguments", () => {
  test("keeps absent flags absent", async () => {
    const args = await cmd.run(parser, []);
    expect(args.credentialsActions).toEqual([]);
    expect(args.enableManagedCredentials).toBeUndefined();
    expect(args.credentialsPersistConfiguration).toBeUndefined();
  });
  test("parses explicit rights and independent identities", async () => {
    const args = await cmd.run(parser, [
      "--credentials-repo",
      "o/r",
      "--credentials-action",
      "issues:read",
      "--credentials-action",
      "issues:comment",
      "--credentials-commit-as",
      "Ada <ada@example.com>",
      "--credentials-act-as",
      "42",
      "--credentials-no-write",
      "--dry-run",
    ]);
    expect(args).toMatchObject({
      credentialsRepo: "o/r",
      credentialsActions: ["issues:read", "issues:comment"],
      credentialsCommitAs: "Ada <ada@example.com>",
      credentialsActAs: "42",
      credentialsNoWrite: true,
      dryRun: true,
    });
  });
  test.each([
    ["--credentials-persist-configuration", ""],
    ["--credentials-persist-configuration=./config.json", "./config.json"],
  ])("parses %s", async (flag, expected) => {
    expect(
      (await cmd.run(parser, [flag])).credentialsPersistConfiguration,
    ).toBe(expected);
  });
  test("rejects repeated persistence and space-separated paths", async () => {
    for (const argv of [
      [
        "--credentials-persist-configuration",
        "--credentials-persist-configuration",
      ],
      ["--credentials-persist-configuration", "./config.json"],
    ]) {
      expect((await cmd.runSafely(parser, argv))._tag).toBe("error");
    }
  });
  test.each([
    "--github-repo",
    "--git-source",
    "--managed-credentials-file",
    "--commit-as-name",
  ])("does not register legacy %s", async (flag) => {
    expect((await cmd.runSafely(parser, [flag, "value"]))._tag).toBe("error");
  });
});
