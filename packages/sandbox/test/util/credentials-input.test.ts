import * as cmd from "cmd-ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { managedCredentialOptions } from "../../src/args/managed-credentials";
import { persistConfiguration } from "../../src/util/managed-credentials-persist";
import {
  assertCompatibleOptions,
  parseActions,
  resolveManagedCredentials,
} from "../../src/util/managed-credentials-resolve";
import { renderManagedCredentialsRetryCommand } from "../../src/util/managed-credentials-retry-command";

const parser = cmd.command({
  name: "credentials",
  args: managedCredentialOptions,
  handler: (args) => {
    assertCompatibleOptions(args);
    return args;
  },
});

async function parse(argv: string[]) {
  const result = await cmd.runSafely(parser, argv);
  if (result._tag === "error") throw new Error("Invalid credential arguments");
  return result.value;
}

const credentials = {
  github: [
    {
      repositories: ["acme/widgets", "acme/tools"],
      actions: ["git:write" as const, "github:issues:read" as const],
      actAs: "@example",
    },
  ],
};

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "credentials-input-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("selects GitHub credentials with a provider argument and preserves defaults", async () => {
  const options = await parse(["--credentials=github"]);
  const result = await resolveManagedCredentials(options, {
    token: "unused",
    inferRepositoryImpl: async () => "acme/widgets",
    inferActorImpl: async () => ({ actAs: "@example" }),
  });
  expect(result?.config.credentials.github[0]).toEqual({
    repositories: ["acme/widgets"],
    actions: [
      "github:issues:read",
      "github:issues:comment",
      "github:pull-request:create",
      "git:write",
    ],
    actAs: "@example",
  });
});

test.each(["github,npm", "github,github", "github,", "", "npm"])(
  "rejects unsupported or empty provider selections: %s",
  async (providers) => {
    await expect(parse([`--credentials=${providers}`])).rejects.toThrow();
  },
);

test("rejects provider selection without an argument", async () => {
  expect((await cmd.runSafely(parser, ["--credentials"]))._tag).toBe("error");
});

test("canonicalizes a comma-separated action list without widening access", () => {
  expect(
    parseActions([" git:write, issues:read,github:issues:comment "]),
  ).toEqual(["git:write", "github:issues:read", "github:issues:comment"]);
});

test.each([
  "git:write,",
  ",git:write",
  "git:write,,issues:read",
  "issues:read,github:issues:read",
])("rejects empty or duplicate actions in a list: %s", (actions) => {
  expect(() => parseActions([actions])).toThrow();
});

test("passes an action list through argument parsing and request resolution", async () => {
  const options = await parse([
    "--credentials-github-repo=acme/widgets",
    "--credentials-github-act-as=@example",
    "--credentials-github-action=github:issues:read,github:issues:comment",
  ]);
  const result = await resolveManagedCredentials(options, { token: "unused" });
  expect(result?.config.credentials.github[0].actions).toEqual([
    "github:issues:read",
    "github:issues:comment",
  ]);
});

test("loads the API credentials object without inferring source, rights, or actor", async () => {
  const file = join(directory, "credentials.json");
  await writeFile(file, JSON.stringify(credentials));
  const options = await parse([`--credentials-file=${file}`]);
  const result = await resolveManagedCredentials(options, { token: "unused" });
  expect(result?.config).toEqual({ credentials });
  expect(result?.fromConfigFile).toBe(true);
});

test("writes credentials that can be replayed through the credentials file flag", async () => {
  const file = join(directory, "saved.json");
  await persistConfiguration({
    path: file,
    config: {
      source: { type: "git", url: "https://github.com/acme/widgets.git" },
      credentials,
    },
  });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(credentials);
  const options = await parse([`--credentials-file=${file}`]);
  const result = await resolveManagedCredentials(options, { token: "unused" });
  expect(result?.config).toEqual({ credentials });
});

test("renders recovery actions as one comma-separated option", () => {
  const command = renderManagedCredentialsRetryCommand({
    config: {
      source: { type: "git", url: "https://github.com/acme/widgets.git" },
      credentials: {
        github: [{ ...credentials.github[0], repositories: ["acme/widgets"] }],
      },
    },
    team: "team_example",
    project: "prj_example",
    vcpus: 2,
  });
  expect(command).toContain(
    "--credentials-github-action=git:write,github:issues:read",
  );
  expect(command?.match(/--credentials-github-action=/g)).toHaveLength(1);
});

test.each([
  "--enable-github-credentials",
  "--credentials-github-from-config-file=file.json",
])("does not register %s", async (option) => {
  expect((await cmd.runSafely(parser, [option]))._tag).toBe("error");
});
