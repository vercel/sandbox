import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  inferCommitIdentity,
  parseCommitAs,
  commitIdentityFromProfile,
} from "../../src/util/managed-credentials-commit";
import {
  runCommand,
  readCommand,
} from "../../src/util/managed-credentials-command";

describe("read-only metadata helpers", () => {
  test("distinguishes missing helpers from failed commands", async () => {
    expect(await runCommand("sandbox-nonexistent-command", [], 1000)).toEqual({
      status: "absent",
    });
    expect(
      (await runCommand(process.execPath, ["-e", "process.exit(1)"], 1000))
        .status,
    ).toBe("failed");
    expect(
      await readCommand(process.execPath, ["-e", "process.exit(1)"], 1000),
    ).toBeUndefined();
  });
  test("bounds execution time", async () => {
    expect(
      (
        await runCommand(
          process.execPath,
          ["-e", "setInterval(()=>{},1000)"],
          50,
        )
      ).status,
    ).toBe("failed");
  });
});
describe("commit identity", () => {
  test("reads repository-local overrides without changing config", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sandbox-commit-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8" });
    try {
      git("init", "-q");
      git("config", "user.name", "Local Author");
      git("config", "user.email", "local@example.com");
      expect(await inferCommitIdentity(cwd)).toEqual({
        name: "Local Author",
        email: "local@example.com",
      });
      expect(git("config", "--get", "user.name").trim()).toBe("Local Author");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  test("parses explicit credit", () => {
    expect(parseCommitAs(" Ada Lovelace <ada@example.com> ")).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });
  test.each(["Ada", "<ada@example.com>", "Ada <invalid>"])(
    "rejects %s",
    (value) => {
      expect(() => parseCommitAs(value)).toThrow();
    },
  );
  test("uses GitHub noreply credit before profile email", () => {
    expect(
      commitIdentityFromProfile({
        githubName: "Ada",
        githubLogin: "ada",
        githubId: "42",
        githubEmail: "private@example.com",
      }),
    ).toEqual({ name: "Ada", email: "42+ada@users.noreply.github.com" });
    expect(
      commitIdentityFromProfile({
        vercelName: "Ada",
        vercelEmail: "ada@example.com",
      }),
    ).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(commitIdentityFromProfile({ githubLogin: "ada" })).toBeUndefined();
  });
});
