import * as cmd from "cmd-ts";
import { describe, expect, test } from "vitest";
import { managedCredentialOptions } from "../../src/args/managed-credentials";

const parser = cmd.command({
  name: "credentials",
  args: managedCredentialOptions,
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
      "--credentials-github-repo",
      "o/r",
      "--credentials-github-action",
      "issues:read",
      "--credentials-github-action",
      "issues:comment",
      "--credentials-github-act-as",
      "42",
    ]);
    expect(args).toMatchObject({
      credentialsRepo: "o/r",
      credentialsActions: ["issues:read", "issues:comment"],
      credentialsActAs: "42",
    });
  });
  test("takes the persistence path in either form", async () => {
    for (const argv of [
      ["--credentials-github-persist-configuration", "./config.json"],
      ["--credentials-github-persist-configuration=./config.json"],
    ])
      expect(
        (await cmd.run(parser, argv)).credentialsPersistConfiguration,
      ).toBe("./config.json");
  });
  test.each([
    "--github-repo",
    "--git-source",
    "--managed-credentials-file",
    "--commit-as-name",
    // Retired surfaces must not quietly come back as unvalidated options.
    "--github-access",
    "--credentials-github-no-write",
    "--credentials-github-commit-as",
  ])("does not register %s", async (flag) => {
    expect((await cmd.runSafely(parser, [flag, "value"]))._tag).toBe("error");
  });
});
