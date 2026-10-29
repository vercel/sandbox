import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  MANAGED_CREDENTIALS_GATE,
  resolveCreationInput,
  validateCreationInput,
  type CreationOptions,
} from "../../src/util/creation-input";

const empty: CreationOptions = { githubRepositories: [], githubActions: [] };
const identity = { name: "Grace Hopper", email: "grace@example.com" };
const source = { type: "git", url: "https://github.com/acme/widgets.git" };

describe("creation inputs", () => {
  let directory: string;
  beforeEach(async () => {
    vi.stubEnv(MANAGED_CREDENTIALS_GATE, "1");
    directory = await mkdtemp(join(tmpdir(), "sandbox-creation-input-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  test("the gate is required only when new inputs are supplied", async () => {
    vi.stubEnv(MANAGED_CREDENTIALS_GATE, "");
    await expect(resolveCreationInput(empty)).resolves.toEqual({});
    await expect(
      resolveCreationInput({ ...empty, github: true }),
    ).rejects.toThrow("experimental");
  });

  test("an empty GitHub list is distinct from omission", async () => {
    await expect(resolveCreationInput(empty)).resolves.toEqual({});
    await expect(
      resolveCreationInput({ ...empty, github: true }),
    ).resolves.toEqual({ credentials: { github: [] } });
    await expect(
      resolveCreationInput({ ...empty, noGithub: true }),
    ).resolves.toEqual({});
    await expect(
      resolveCreationInput({ ...empty, github: false }),
    ).resolves.toEqual({});
  });

  test("flat options form exactly one group and preserve repeated values", async () => {
    await expect(
      resolveCreationInput({
        ...empty,
        gitSource: source.url,
        commitAsName: identity.name,
        commitAsEmail: identity.email,
        githubRepositories: ["acme/widgets", "acme/reference"],
        githubActions: ["github:issues:read", "github:pull-request:create"],
        githubActAs: "42",
      }),
    ).resolves.toEqual({
      source,
      commitAs: identity,
      credentials: {
        github: [
          {
            repositories: ["acme/widgets", "acme/reference"],
            actions: ["github:issues:read", "github:pull-request:create"],
            actAs: "42",
          },
        ],
      },
    });
  });

  test("--commit-as-me reads Git's global name and email", async () => {
    const config = join(directory, "gitconfig");
    await writeFile(
      config,
      "[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n",
    );
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    await expect(
      resolveCreationInput({
        ...empty,
        gitSource: source.url,
        commitAsMe: true,
      }),
    ).resolves.toEqual({ source, commitAs: identity });
  });

  test.each([
    { commitAsName: "Grace Hopper" },
    { commitAsEmail: "grace@example.com" },
    { commitAsName: "Grace Hopper", commitAsEmail: "grace@example.com" },
  ])("--commit-as-me rejects an explicit identity %#", async (explicit) => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", join(directory, "does-not-exist"));
    await expect(
      resolveCreationInput({
        ...empty,
        gitSource: source.url,
        commitAsMe: true,
        ...explicit,
      }),
    ).rejects.toThrow("--commit-as-me cannot be combined");
  });

  test.each([
    ["both missing", ""],
    ["name missing", "[user]\n email = grace@example.com\n"],
    ["email missing", "[user]\n name = Grace Hopper\n"],
    ["name empty", "[user]\n name =\n email = grace@example.com\n"],
  ])("--commit-as-me fails when %s", async (_label, content) => {
    const config = join(directory, "gitconfig");
    await writeFile(config, content);
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    await expect(
      resolveCreationInput({
        ...empty,
        gitSource: source.url,
        commitAsMe: true,
      }),
    ).rejects.toThrow("Git's global user.name and user.email");
  });

  test("--commit-as-me rejects an invalid global email without echoing it", async () => {
    const config = join(directory, "gitconfig");
    await writeFile(
      config,
      "[user]\n name = Grace Hopper\n email = not-an-email\n",
    );
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    const error = await resolveCreationInput({
      ...empty,
      gitSource: source.url,
      commitAsMe: true,
    }).catch((error) => error);
    expect(error.message).toContain("commitAs.email");
    expect(error.message).not.toContain("not-an-email");
  });

  test("--commit-as-me requires Git and an HTTPS GitHub source", async () => {
    await expect(
      resolveCreationInput({ ...empty, commitAsMe: true }),
    ).rejects.toThrow("requires an HTTPS GitHub source");
    await expect(
      resolveCreationInput({
        ...empty,
        commitAsMe: true,
        gitSource: "https://example.com/acme/widgets",
      }),
    ).rejects.toThrow("requires an HTTPS GitHub source");
    vi.stubEnv("PATH", directory);
    await expect(
      resolveCreationInput({
        ...empty,
        commitAsMe: true,
        gitSource: source.url,
      }),
    ).rejects.toThrow("Git's global user.name and user.email");
  });

  test("--commit-as-me follows Boolean negation and conflicts with a file", async () => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", join(directory, "missing"));
    await expect(
      resolveCreationInput({ ...empty, commitAsMe: false }),
    ).resolves.toEqual({});
    await expect(
      resolveCreationInput({ ...empty, noCommitAsMe: true }),
    ).resolves.toEqual({});
    await expect(
      resolveCreationInput({ ...empty, commitAsMe: true, noCommitAsMe: true }),
    ).rejects.toThrow("cannot be used together");
    await expect(
      resolveCreationInput({ ...empty, commitAsMe: true, file: "input.json" }),
    ).rejects.toThrow("--file cannot be combined");
  });

  test.each([
    { commitAsName: "Grace" },
    { commitAsEmail: "grace@example.com" },
    { githubRepositories: ["acme/widgets"] },
    { githubActions: ["github:issues:read"] },
    { githubActAs: "42" },
    { github: true, noGithub: true },
    {
      noGithub: true,
      githubRepositories: ["acme/widgets"],
      githubActions: ["github:issues:read"],
    },
    {
      githubRepositories: ["acme/widgets"],
      githubActions: ["github:issues:read,github:issues:create"],
    },
    {
      githubRepositories: ["acme/widgets", "ACME/widgets"],
      githubActions: ["github:issues:read"],
    },
    {
      githubRepositories: ["acme/widgets"],
      githubActions: ["github:issues:read", "github:issues:read"],
    },
    { githubRepositories: ["acme/widgets"], githubActions: ["git:write"] },
    {
      githubRepositories: ["acme/widgets"],
      githubActions: ["github:issues:read"],
      githubActAs: "grace",
    },
    {
      githubRepositories: ["acme/widgets"],
      githubActions: ["github:issues:read"],
      githubActAs: "9007199254740992",
    },
    { gitSource: "https://user:password@github.com/acme/widgets.git" },
    { gitSource: "" },
  ])("rejects invalid flat inputs %#", async (options) => {
    await expect(
      resolveCreationInput({ ...empty, ...options }),
    ).rejects.toThrow();
  });

  test.each([
    { commitAs: identity },
    {
      source: { type: "tarball", url: "https://example.com/source.tar.gz" },
      commitAs: identity,
    },
    {
      source: { type: "snapshot", snapshotId: "snap_123" },
      commitAs: identity,
    },
    {
      source: { type: "git", url: "https://gitlab.com/acme/widgets.git" },
      commitAs: identity,
    },
    {
      source: {
        type: "git",
        url: "https://github.com/acme/widgets.git?token=secret",
      },
      commitAs: identity,
    },
    { source: { ...source, credentials: true }, commitAs: identity },
    { source: { ...source, password: "secret" } },
    { commitAs: { name: "Grace", email: "invalid" }, source },
    { __credentials: { github: [] } },
    { projectId: "another-project", credentials: { github: [] } },
    {
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["github:issues:read"],
            actAs: 42,
          },
        ],
      },
    },
    { credentials: {} },
  ])("rejects invalid JSON fields %#", (value) => {
    expect(() => validateCreationInput(value)).toThrow();
  });

  test("file input preserves independent groups and never changes context", async () => {
    const value = {
      source,
      commitAs: identity,
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["github:pull-request:create"],
            actAs: "42",
          },
          {
            repositories: ["acme/reference"],
            actions: ["github:issues:read"],
            actAs: "43",
          },
        ],
      },
    };
    const file = join(directory, "creation.json");
    await writeFile(file, JSON.stringify(value));
    await expect(resolveCreationInput({ ...empty, file })).resolves.toEqual(
      value,
    );
    await expect(
      resolveCreationInput({ ...empty, file, github: false }),
    ).rejects.toThrow("cannot be combined");
  });

  test("allows the same repository in multiple groups only with a consistent identity", () => {
    const group = {
      repositories: ["acme/widgets"],
      actions: ["github:issues:read"],
      actAs: "42",
    };
    expect(() =>
      validateCreationInput({
        credentials: {
          github: [group, { ...group, actions: ["github:issues:create"] }],
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateCreationInput({
        credentials: { github: [group, { ...group, actAs: "43" }] },
      }),
    ).toThrow("one identity per repository");
    expect(() =>
      validateCreationInput({
        credentials: { github: [group, { ...group, actAs: undefined }] },
      }),
    ).toThrow("one identity per repository");
  });

  test("counts the managed source in the 25 distinct repository limit", () => {
    const credentials = {
      github: [
        {
          repositories: Array.from(
            { length: 25 },
            (_, n) => `acme/repository-${n}`,
          ),
          actions: ["github:issues:read"],
        },
      ],
    };
    expect(() => validateCreationInput({ credentials })).not.toThrow();
    expect(() =>
      validateCreationInput({ source, commitAs: identity, credentials }),
    ).toThrow("at most 25");
  });

  test("never echoes malformed JSON, secrets, or unknown field names", async () => {
    const file = join(directory, "bad.json");
    await writeFile(file, '{"token":"secret-value"');
    const error = await resolveCreationInput({ ...empty, file }).catch(
      (error) => error,
    );
    expect(error.message).not.toContain("secret-value");
    await writeFile(file, '{"secret-value":"secret-value"}');
    const schemaError = await resolveCreationInput({ ...empty, file }).catch(
      (error) => error,
    );
    expect(JSON.stringify(schemaError.options)).not.toContain("secret-value");
    expect(schemaError.message).not.toContain("secret-value");
  });

  test("rejects unreadable, directory, oversized and invalid UTF-8 files", async () => {
    await expect(
      resolveCreationInput({ ...empty, file: join(directory, "missing") }),
    ).rejects.toThrow("Can't read");
    await expect(
      resolveCreationInput({ ...empty, file: directory }),
    ).rejects.toThrow("regular JSON file");
    const file = join(directory, "large.json");
    await writeFile(file, " ".repeat(65537));
    await expect(resolveCreationInput({ ...empty, file })).rejects.toThrow(
      "64 KiB",
    );
    await writeFile(file, Buffer.from([0xff]));
    await expect(resolveCreationInput({ ...empty, file })).rejects.toThrow(
      "UTF-8",
    );
  });

  test("reads JSON from stdin without prompting", async () => {
    const stdin = new PassThrough();
    vi.spyOn(process, "stdin", "get").mockReturnValue(
      stdin as typeof process.stdin,
    );
    const result = resolveCreationInput({ ...empty, file: "-" });
    stdin.end('{"credentials":{"github":[]}}');
    await expect(result).resolves.toEqual({ credentials: { github: [] } });
    expect(stdin.listenerCount("data")).toBe(0);
  });
});
