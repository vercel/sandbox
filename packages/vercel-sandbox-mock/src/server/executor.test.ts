import { describe, expect, test } from "vitest";
import { Executor } from "./executor";
import { createUserState } from "./registry";

async function makeExecutor() {
  return Executor.create({
    cwd: "/vercel/sandbox",
    users: createUserState(),
    customCommands: [],
  });
}

describe("Executor", () => {
  test("runs a command and reports stdout/exitCode/timing", async () => {
    const exec = await makeExecutor();
    const result = await exec.run({ command: "echo", args: ["hi"] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hi\n");
    expect(typeof result.startedAt).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("non-zero exit is preserved", async () => {
    const exec = await makeExecutor();
    expect((await exec.run({ command: "false", args: [] })).exitCode).toBe(1);
  });

  test("honors cwd and env", async () => {
    const exec = await makeExecutor();
    expect((await exec.run({ command: "pwd", args: [], cwd: "/tmp" })).stdout.trim()).toBe("/tmp");
    const env = await exec.run({ command: "printenv", args: ["X"], env: { X: "y" } });
    expect(env.stdout.trim()).toBe("y");
  });

  test("unwraps `sudo -u <user> --` and runs the inner command", async () => {
    const exec = await makeExecutor();
    const result = await exec.run({
      command: "sudo",
      args: ["-u", "alice", "--", "echo", "inner"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("inner\n");
  });

  describe("filesystem coreutils interception", () => {
    test("stat -c emits the SDK's expected format", async () => {
      const exec = await makeExecutor();
      await exec.run({ command: "sh", args: ["-c", "printf abc > /tmp/f"] });
      const stat = await exec.run({
        command: "stat",
        args: ["-L", "-c", "%s|%f|%u|%g|%X|%Y|%Z|%W|%h|%i|%d|%B|%b", "/tmp/f"],
      });
      const parts = stat.stdout.trim().split("|");
      expect(Number(parts[0])).toBe(3); // size
      expect(parseInt(parts[1], 16) & 0o170000).toBe(0o100000); // regular file type bits
    });

    test("stat on a missing path fails with ENOENT-shaped stderr", async () => {
      const exec = await makeExecutor();
      const stat = await exec.run({ command: "stat", args: ["-c", "%s", "/nope"] });
      expect(stat.exitCode).toBe(1);
      expect(stat.stderr).toContain("No such file or directory");
    });

    test("find -printf lists entries as name|type", async () => {
      const exec = await makeExecutor();
      await exec.run({ command: "sh", args: ["-c", "mkdir -p /d/sub && printf x > /d/f"] });
      const find = await exec.run({
        command: "find",
        args: ["/d", "-maxdepth", "1", "-mindepth", "1", "-printf", "%f|%y\\n"],
      });
      const lines = find.stdout.trim().split("\n").sort();
      expect(lines).toContain("f|f");
      expect(lines).toContain("sub|d");
    });

    test("truncate grows and shrinks; mktemp is unique; realpath resolves; test -e", async () => {
      const exec = await makeExecutor();
      await exec.run({ command: "sh", args: ["-c", "printf abcd > /tmp/t"] });
      await exec.run({ command: "truncate", args: ["-s", "2", "/tmp/t"] });
      expect((await exec.run({ command: "cat", args: ["/tmp/t"] })).stdout).toBe("ab");

      const a = (await exec.run({ command: "mktemp", args: ["-d", "/tmp/x-XXXXXX"] })).stdout.trim();
      const b = (await exec.run({ command: "mktemp", args: ["-d", "/tmp/x-XXXXXX"] })).stdout.trim();
      expect(a).not.toBe(b);

      await exec.run({ command: "sh", args: ["-c", "ln -s /tmp/t /tmp/link"] });
      expect((await exec.run({ command: "realpath", args: ["/tmp/link"] })).stdout.trim()).toBe(
        "/tmp/t",
      );

      expect((await exec.run({ command: "test", args: ["-e", "/tmp/t"] })).exitCode).toBe(0);
      expect((await exec.run({ command: "test", args: ["-e", "/nope"] })).exitCode).toBe(1);
    });
  });

  describe("user/group commands", () => {
    test("useradd creates a user with a home dir and matching primary group", async () => {
      const users = createUserState();
      const exec = await Executor.create({ cwd: "/vercel/sandbox", users, customCommands: [] });
      expect((await exec.run({ command: "useradd", args: ["-m", "-s", "/bin/bash", "alice"] })).exitCode).toBe(0);
      expect(users.users.has("alice")).toBe(true);
      expect((await exec.run({ command: "test", args: ["-e", "/home/alice"] })).exitCode).toBe(0);
      expect((await exec.run({ command: "id", args: ["-gn", "alice"] })).stdout.trim()).toBe("alice");
      expect((await exec.run({ command: "id", args: ["-un"] })).stdout.trim()).toBe("vercel-sandbox");
    });

    test("useradd twice fails", async () => {
      const exec = await makeExecutor();
      await exec.run({ command: "useradd", args: ["-m", "alice"] });
      const second = await exec.run({ command: "useradd", args: ["-m", "alice"] });
      expect(second.exitCode).not.toBe(0);
      expect(second.stderr).toContain("already exists");
    });

    test("group membership add/remove round-trips; errors on unknown", async () => {
      const exec = await makeExecutor();
      await exec.run({ command: "useradd", args: ["-m", "alice"] });
      await exec.run({ command: "groupadd", args: ["devs"] });
      expect((await exec.run({ command: "usermod", args: ["-aG", "devs", "alice"] })).exitCode).toBe(0);
      expect((await exec.run({ command: "gpasswd", args: ["-d", "alice", "devs"] })).exitCode).toBe(0);
      expect((await exec.run({ command: "gpasswd", args: ["-d", "alice", "devs"] })).exitCode).not.toBe(0);
      expect((await exec.run({ command: "usermod", args: ["-aG", "nope", "alice"] })).exitCode).not.toBe(0);
    });
  });
});
