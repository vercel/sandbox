import { describe, expect, test, vi } from "vitest";
import {
  commitIdentityFromProfile,
  inferActor,
  parseCommitAs,
  readGhAccount,
  readVercelGithubLink,
  repositoryFromRemote,
} from "../../src/util/managed-credentials-inference";
import { CliError } from "../../src/util/cli-error";

describe("remote parsing", () => {
  test.each([
    ["https://github.com/vercel/api.git", "vercel/api"],
    ["git@github.com:vercel/api.git", "vercel/api"],
    ["ssh://git@github.com/vercel/api.git", "vercel/api"],
    ["git@github.com:vercel/api", "vercel/api"],
  ])("accepts %s", (remote, expected) => {
    expect(repositoryFromRemote(remote)).toBe(expected);
  });

  test.each([
    "git@gitlab.com:vercel/api.git",
    "https://github.enterprise.com/vercel/api.git",
    "/local/path/repo",
  ])("rejects %s", (remote) => {
    expect(repositoryFromRemote(remote)).toBeUndefined();
  });
});

describe("--credentials-commit-as parsing", () => {
  test("parses a name and email", () => {
    expect(parseCommitAs("Jack Jackson <scubbojj@gmail.com>")).toEqual({
      name: "Jack Jackson",
      email: "scubbojj@gmail.com",
    });
  });

  test("tolerates surrounding whitespace", () => {
    expect(parseCommitAs("  Ada Lovelace  < ada@example.com > ")).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  test.each([
    "no-angle-brackets",
    "<only@example.com>",
    "Name <not-an-email>",
    "Name <>",
  ])("rejects %s", (value) => {
    expect(() => parseCommitAs(value)).toThrow(CliError);
  });
});

describe("actor precedence", () => {
  const readVercel = vi.fn();

  test("an explicit value wins over gh and Vercel", async () => {
    const readGh = vi.fn();
    const actor = await inferActor({
      explicit: "scubbo",
      token: "t",
      readGh,
      readVercel,
    });
    expect(actor).toEqual({
      actAs: "@scubbo",
      login: "scubbo",
      source: "explicit",
    });
    expect(readGh).not.toHaveBeenCalled();
    expect(readVercel).not.toHaveBeenCalled();
  });

  test("an explicit numeric value is kept as an immutable ID", async () => {
    const actor = await inferActor({ explicit: "123456", token: "t" });
    expect(actor).toEqual({ actAs: "123456", source: "explicit" });
  });

  test("gh takes precedence over the Vercel fallback", async () => {
    const readGh = vi.fn().mockResolvedValue({ login: "scubbo", id: 2373726 });
    const actor = await inferActor({ token: "t", readGh, readVercel });
    // The immutable ID authorizes while the login stays readable, so a later
    // rename cannot redirect the grant.
    expect(actor).toMatchObject({
      actAs: "2373726",
      login: "scubbo",
      source: "gh",
    });
    // Profile metadata rides along so the commit-identity fallback does not
    // need a second lookup.
    expect(actor?.profile).toEqual({ id: "2373726", login: "scubbo" });
    expect(readVercel).not.toHaveBeenCalled();
  });

  test("falls back to the username when gh reports no numeric ID", async () => {
    const readGh = vi.fn().mockResolvedValue({ login: "scubbo" });
    const actor = await inferActor({ token: "t", readGh, readVercel });
    expect(actor).toMatchObject({ actAs: "@scubbo", source: "gh" });
  });

  test("queries Vercel only when gh is not logged in", async () => {
    const readGh = vi.fn().mockResolvedValue(undefined);
    const vercel = vi
      .fn()
      .mockResolvedValue({ login: "scubbo", id: "2373726" });
    const actor = await inferActor({
      token: "t",
      readGh,
      readVercel: vercel,
    });
    expect(vercel).toHaveBeenCalledOnce();
    expect(actor).toMatchObject({
      actAs: "2373726",
      login: "scubbo",
      source: "vercel-account-link",
    });
  });

  test("does not switch identities after a gh failure", async () => {
    const readGh = vi
      .fn()
      .mockRejectedValue(
        new CliError("gh is logged in but `gh api user` failed."),
      );
    const vercel = vi.fn();
    await expect(
      inferActor({ token: "t", readGh, readVercel: vercel }),
    ).rejects.toThrow(/gh api user/);
    // Falling through to a different account after a transient failure would
    // silently grant access as the wrong user.
    expect(vercel).not.toHaveBeenCalled();
  });

  test("reports no actor when neither source knows one", async () => {
    const actor = await inferActor({
      token: "t",
      readGh: vi.fn().mockResolvedValue(undefined),
      readVercel: vi.fn().mockResolvedValue(undefined),
    });
    expect(actor).toBeUndefined();
  });
});

describe("reading the gh account", () => {
  // `gh` is driven through a stub binary so the suite never depends on a real
  // gh install or login state.
  const withStubGh = async (script: string, run: () => Promise<unknown>) => {
    const { mkdtemp, writeFile, chmod, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const directory = await mkdtemp(join(tmpdir(), "stub-gh-"));
    const binary = join(directory, "gh");
    await writeFile(binary, `#!/bin/sh\n${script}\n`, "utf8");
    await chmod(binary, 0o755);
    const previous = process.env.PATH;
    process.env.PATH = `${directory}:${previous}`;
    try {
      return await run();
    } finally {
      process.env.PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  };

  test("returns the account when gh is logged in", async () => {
    const account = await withStubGh(
      `case "$1" in
         auth) echo "Logged in to github.com account scubbo"; exit 0;;
         api) echo '{"login":"scubbo","id":2373726,"name":"Jack","email":null}'; exit 0;;
       esac`,
      () => readGhAccount(),
    );
    expect(account).toEqual({ login: "scubbo", id: 2373726, name: "Jack" });
  });

  test("reports no account when gh is not logged in", async () => {
    const account = await withStubGh(
      `echo "You are not logged into any GitHub hosts." >&2; exit 1`,
      () => readGhAccount(),
    );
    expect(account).toBeUndefined();
  });

  test("fails instead of falling through when gh errors transiently", async () => {
    // A network failure must not look like "no gh answer", which would hand
    // the request to the Vercel-linked account instead.
    await expect(
      withStubGh(`echo "error connecting to github.com" >&2; exit 1`, () =>
        readGhAccount(),
      ),
    ).rejects.toThrow(/does not fall back to another identity/);
  });

  test("fails when gh is logged in but the user lookup fails", async () => {
    await expect(
      withStubGh(
        `case "$1" in
           auth) echo "Logged in to github.com account scubbo"; exit 0;;
           api) echo "HTTP 502" >&2; exit 1;;
         esac`,
        () => readGhAccount(),
      ),
    ).rejects.toThrow(/gh api user` failed/);
  });

  test("reports no account when gh is not installed", async () => {
    const previous = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      expect(await readGhAccount()).toBeUndefined();
    } finally {
      process.env.PATH = previous;
    }
  });
});

describe("Vercel account links", () => {
  const respond = (body: unknown, status = 200) =>
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response);

  test("uses the default github.com login connection", async () => {
    const link = await readVercelGithubLink({
      token: "t",
      fetch: respond({
        accountLinks: [
          {
            provider: "github",
            type: "login",
            login: "scubbo",
            providerUserId: 2373726,
            name: "Jack Jackson",
          },
        ],
      }),
    });
    expect(link).toEqual({
      login: "scubbo",
      id: "2373726",
      name: "Jack Jackson",
    });
  });

  test("ignores a non-GitHub provider", async () => {
    const link = await readVercelGithubLink({
      token: "t",
      fetch: respond({
        accountLinks: [{ provider: "gitlab", type: "login", login: "someone" }],
      }),
    });
    expect(link).toBeUndefined();
  });

  test("ignores an enterprise host", async () => {
    const link = await readVercelGithubLink({
      token: "t",
      fetch: respond({
        accountLinks: [
          {
            provider: "github",
            type: "login",
            host: "github.enterprise.com",
            login: "someone",
          },
        ],
      }),
    });
    expect(link).toBeUndefined();
  });

  test("ignores a limited connection", async () => {
    const link = await readVercelGithubLink({
      token: "t",
      fetch: respond({
        accountLinks: [
          { provider: "github", type: "limited", login: "someone" },
        ],
      }),
    });
    expect(link).toBeUndefined();
  });

  test("treats an ambiguous account list as unknown", async () => {
    const link = await readVercelGithubLink({
      token: "t",
      fetch: respond({
        accountLinks: [
          { provider: "github", type: "login", login: "one" },
          { provider: "github", type: "login", login: "two" },
        ],
      }),
    });
    expect(link).toBeUndefined();
  });

  test("a failed lookup is an error, not an empty answer", async () => {
    await expect(
      readVercelGithubLink({ token: "t", fetch: respond({}, 500) }),
    ).rejects.toThrow(CliError);
  });

  test("a network failure is an error, not an empty answer", async () => {
    await expect(
      readVercelGithubLink({
        token: "t",
        fetch: vi.fn().mockRejectedValue(new Error("offline")),
      }),
    ).rejects.toThrow(/Could not reach Vercel/);
  });
});

describe("commit identity fallback", () => {
  test("prefers the connected GitHub profile name", () => {
    expect(
      commitIdentityFromProfile({
        githubName: "Jack Jackson",
        githubLogin: "scubbo",
        githubId: 2373726,
        vercelName: "Ignored",
      }),
    ).toEqual({
      name: "Jack Jackson",
      email: "2373726+scubbo@users.noreply.github.com",
    });
  });

  test("falls back through login, Vercel name, then username", () => {
    expect(
      commitIdentityFromProfile({
        githubLogin: "scubbo",
        githubId: 1,
      })?.name,
    ).toBe("scubbo");
    expect(
      commitIdentityFromProfile({
        vercelName: "Jack",
        vercelEmail: "jack@example.com",
      })?.name,
    ).toBe("Jack");
    expect(
      commitIdentityFromProfile({
        vercelUsername: "jackj",
        vercelEmail: "jack@example.com",
      })?.name,
    ).toBe("jackj");
  });

  test("builds the noreply address from the numeric ID and login", () => {
    expect(
      commitIdentityFromProfile({
        githubLogin: "scubbo",
        githubId: "2373726",
        githubEmail: "ignored@example.com",
      })?.email,
    ).toBe("2373726+scubbo@users.noreply.github.com");
  });

  test("uses the linked GitHub email when no numeric ID is available", () => {
    expect(
      commitIdentityFromProfile({
        githubLogin: "scubbo",
        githubEmail: "scubbo@example.com",
      })?.email,
    ).toBe("scubbo@example.com");
  });

  test("falls back to the Vercel email last", () => {
    expect(
      commitIdentityFromProfile({
        githubLogin: "scubbo",
        vercelEmail: "jack@example.com",
      })?.email,
    ).toBe("jack@example.com");
  });

  test("does not fabricate an identity from insufficient metadata", () => {
    expect(commitIdentityFromProfile({})).toBeUndefined();
    expect(
      commitIdentityFromProfile({ githubLogin: "scubbo" }),
    ).toBeUndefined();
    expect(
      commitIdentityFromProfile({ vercelEmail: "jack@example.com" }),
    ).toBeUndefined();
  });
});
