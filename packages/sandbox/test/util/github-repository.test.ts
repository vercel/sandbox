import { afterAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inferGithubRepository,
  repositoryFromRemote,
} from "../../src/util/github-repository.ts";

const directories: string[] = [];

/** Creates a real Git repository with the given remotes, in order. */
function repository(remotes: Array<[name: string, url: string]>): string {
  const directory = mkdtempSync(join(tmpdir(), "github-repository-"));
  directories.push(directory);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  git("init", "--quiet");
  for (const [name, url] of remotes) {
    git("remote", "add", name, url);
  }
  return directory;
}

afterAll(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("repositoryFromRemote", () => {
  test.each([
    ["https://github.com/acme/web.git", "acme/web"],
    ["https://github.com/acme/web", "acme/web"],
    ["https://github.com/acme/web/", "acme/web"],
    ["git@github.com:acme/web.git", "acme/web"],
    ["ssh://git@github.com/acme/web.git", "acme/web"],
    ["HTTPS://GitHub.com/Acme/Web.git", "Acme/Web"],
  ])("reads %s as %s", (remote, expected) => {
    expect(repositoryFromRemote(remote)).toBe(expected);
  });

  test.each([
    "https://gitlab.com/acme/web.git",
    "https://github.example.com/acme/web.git",
    "https://token@github.com/acme/web.git",
    "https://github.com/acme",
    "https://github.com/acme/web/tree/main",
    "git@github.com:acme/..",
    "/srv/git/web.git",
  ])("does not read %s as a GitHub repository", (remote) => {
    expect(repositoryFromRemote(remote)).toBeUndefined();
  });
});

describe("inferGithubRepository", () => {
  test("prefers the origin remote", async () => {
    const directory = repository([
      ["upstream", "https://github.com/vercel/web.git"],
      ["origin", "git@github.com:acme/web.git"],
    ]);
    await expect(inferGithubRepository(directory)).resolves.toBe("acme/web");
  });

  test("without origin, uses the one repository the GitHub remotes name", async () => {
    const directory = repository([
      ["mirror", "https://gitlab.com/acme/web.git"],
      ["upstream", "https://github.com/vercel/web.git"],
      ["ssh", "git@github.com:vercel/web.git"],
    ]);
    await expect(inferGithubRepository(directory)).resolves.toBe("vercel/web");
  });

  test("without origin, does not choose between different GitHub repositories", async () => {
    const directory = repository([
      ["upstream", "https://github.com/vercel/web.git"],
      ["fork", "https://github.com/acme/web.git"],
    ]);
    await expect(inferGithubRepository(directory)).resolves.toBeUndefined();
  });

  test("finds nothing when origin is not on GitHub and no other remote is", async () => {
    const directory = repository([
      ["origin", "https://gitlab.com/acme/web.git"],
    ]);
    await expect(inferGithubRepository(directory)).resolves.toBeUndefined();
  });

  test("finds nothing outside a Git repository", async () => {
    const directory = mkdtempSync(join(tmpdir(), "not-a-repository-"));
    directories.push(directory);
    await expect(inferGithubRepository(directory)).resolves.toBeUndefined();
  });
});
