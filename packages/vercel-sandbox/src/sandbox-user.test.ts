import { expect, it, beforeEach, afterEach, describe } from "vitest";
import { Sandbox } from "./sandbox.js";
import { SandboxUser } from "./sandbox-user.js";

describe("validateName (unit)", () => {
  it("asUser rejects invalid usernames synchronously", () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      sandbox: { id: "test" } as any,
    });
    expect(() => sandbox.asUser("Alice")).toThrow("Invalid username");
    expect(() => sandbox.asUser("user name")).toThrow("Invalid username");
    expect(() => sandbox.asUser("")).toThrow("Invalid username");
    expect(() => sandbox.asUser("a".repeat(33))).toThrow("Invalid username");
    expect(() => sandbox.asUser("root; rm -rf /")).toThrow("Invalid username");
    expect(() => sandbox.asUser("$(whoami)")).toThrow("Invalid username");
  });

  it("asUser accepts valid usernames", () => {
    const sandbox = new Sandbox({
      client: {} as any,
      routes: [],
      sandbox: { id: "test" } as any,
    });
    expect(sandbox.asUser("alice").username).toBe("alice");
    expect(sandbox.asUser("_user").username).toBe("_user");
    expect(sandbox.asUser("user-name").username).toBe("user-name");
    expect(sandbox.asUser("user_123").username).toBe("user_123");
  });
});

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "SandboxUser integration",
  () => {
    let sandbox: Sandbox;

    beforeEach(async () => {
      sandbox = await Sandbox.create();
    });

    afterEach(async () => {
      await sandbox.stop();
    });

    // ─── User Creation ───────────────────────────────────────────────

    describe("createUser", () => {
      it("creates a user with a home directory", async () => {
        const alice = await sandbox.createUser("alice");

        expect(alice).toBeInstanceOf(SandboxUser);
        expect(alice.username).toBe("alice");
        expect(alice.homeDir).toBe("/home/alice");

        const result = await sandbox.runCommand({
          cmd: "test",
          args: ["-d", "/home/alice"],
          sudo: true,
        });
        expect(result.exitCode).toBe(0);
      });

      it("sets 750 permissions on home directory", async () => {
        await sandbox.createUser("alice");

        const stat = await sandbox.runCommand({
          cmd: "stat",
          args: ["-c", "%a", "/home/alice"],
          sudo: true,
        });
        expect((await stat.stdout()).trim()).toBe("770");
      });

      it("sets home directory group to vercel-sandbox", async () => {
        await sandbox.createUser("alice");

        const stat = await sandbox.runCommand({
          cmd: "stat",
          args: ["-c", "%U:%G", "/home/alice"],
          sudo: true,
        });
        expect((await stat.stdout()).trim()).toBe("alice:vercel-sandbox");
      });

      it("creates multiple users", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");

        const aliceWho = await alice.runCommand("whoami");
        const bobWho = await bob.runCommand("whoami");
        expect((await aliceWho.stdout()).trim()).toBe("alice");
        expect((await bobWho.stdout()).trim()).toBe("bob");
      });

      it("throws on duplicate username", async () => {
        await sandbox.createUser("alice");
        await expect(sandbox.createUser("alice")).rejects.toThrow(
          'Failed to create user "alice"',
        );
      });
    });

    // ─── Command Execution as User ──────────────────────────────────

    describe("runCommand as user", () => {
      it("runs as the correct user", async () => {
        const alice = await sandbox.createUser("alice");
        const whoami = await alice.runCommand("whoami");
        expect((await whoami.stdout()).trim()).toBe("alice");
      });

      it("runs with correct uid/gid", async () => {
        const alice = await sandbox.createUser("alice");
        const id = await alice.runCommand("id");
        const output = (await id.stdout()).trim();
        expect(output).toContain("(alice)");
      });

      it("defaults cwd to home directory", async () => {
        const alice = await sandbox.createUser("alice");
        const pwd = await alice.runCommand("pwd");
        expect((await pwd.stdout()).trim()).toBe("/home/alice");
      });

      it("allows overriding cwd", async () => {
        const alice = await sandbox.createUser("alice");
        const pwd = await alice.runCommand({ cmd: "pwd", cwd: "/tmp" });
        expect((await pwd.stdout()).trim()).toBe("/tmp");
      });

      it("passes environment variables through sudo -u", async () => {
        const alice = await sandbox.createUser("alice");
        const cmd = await alice.runCommand({
          cmd: "env",
          env: { MY_VAR: "hello", ANOTHER: "world" },
        });
        const output = await cmd.stdout();
        expect(output).toContain("MY_VAR=hello");
        expect(output).toContain("ANOTHER=world");
      });

      it("delegates to root when sudo: true", async () => {
        const alice = await sandbox.createUser("alice");
        const whoami = await alice.runCommand({ cmd: "whoami", sudo: true });
        expect((await whoami.stdout()).trim()).toBe("root");
      });

      it("supports detached mode", async () => {
        const alice = await sandbox.createUser("alice");
        const cmd = await alice.runCommand({
          cmd: "sleep",
          args: ["100"],
          detached: true,
        });
        await cmd.kill("SIGTERM");
        const result = await cmd.wait();
        // The command runs inside a bash -c wrapper, so the exit code
        // may differ from a direct kill (e.g., 255 from bash vs 143 for SIGTERM).
        expect(result.exitCode).not.toBe(0);
      });
    });

    // ─── File Operations as User ────────────────────────────────────

    describe("writeFiles + readFile as user", () => {
      it("writes files owned by the user in home dir", async () => {
        const alice = await sandbox.createUser("alice");

        await alice.writeFiles([
          { path: "hello.txt", content: Buffer.from("hello world") },
        ]);

        const stat = await sandbox.runCommand({
          cmd: "stat",
          args: ["-c", "%U:%G", "/home/alice/hello.txt"],
          sudo: true,
        });
        expect((await stat.stdout()).trim()).toBe("alice:alice");
      });

      it("reads files back via readFileToBuffer", async () => {
        const alice = await sandbox.createUser("alice");

        await alice.writeFiles([
          { path: "data.txt", content: Buffer.from("read me") },
        ]);

        const content = await alice.readFileToBuffer({ path: "data.txt" });
        expect(content?.toString()).toBe("read me");
      });

      it("reads files back via readFile (stream)", async () => {
        const alice = await sandbox.createUser("alice");

        await alice.writeFiles([
          { path: "stream.txt", content: Buffer.from("streamed") },
        ]);

        const stream = await alice.readFile({ path: "stream.txt" });
        expect(stream).not.toBeNull();

        const chunks: Buffer[] = [];
        for await (const chunk of stream!) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        expect(Buffer.concat(chunks).toString()).toBe("streamed");
      });

      it("resolves relative paths to home directory", async () => {
        const alice = await sandbox.createUser("alice");

        await alice.writeFiles([
          { path: "subdir/file.txt", content: Buffer.from("nested") },
        ]);

        const exists = await sandbox.runCommand({
          cmd: "test",
          args: ["-f", "/home/alice/subdir/file.txt"],
          sudo: true,
        });
        expect(exists.exitCode).toBe(0);
      });

      it("handles absolute paths", async () => {
        const alice = await sandbox.createUser("alice");

        await alice.writeFiles([
          { path: "/tmp/alice-file.txt", content: Buffer.from("abs path") },
        ]);

        const stat = await sandbox.runCommand({
          cmd: "stat",
          args: ["-c", "%U", "/tmp/alice-file.txt"],
          sudo: true,
        });
        expect((await stat.stdout()).trim()).toBe("alice");
      });

      it("reads files created by user commands (umask makes them group-readable)", async () => {
        const alice = await sandbox.createUser("alice");

        // User creates a file via runCommand — inherits alice:alice ownership + default umask
        await alice.runCommand({
          cmd: "bash",
          args: ["-c", 'echo "from command" > /home/alice/cmd-file.txt'],
        });

        // The HTTP file API (running as vercel-sandbox) should be able to read it
        // because vercel-sandbox is in alice's group and default umask is 0022 (644)
        const content = await alice.readFileToBuffer({
          path: "cmd-file.txt",
        });
        expect(content?.toString()).toBe("from command\n");
      });
    });

    describe("mkDir as user", () => {
      it("creates a directory owned by the user with 750 permissions", async () => {
        const alice = await sandbox.createUser("alice");

        await alice.mkDir("projects");

        const stat = await sandbox.runCommand({
          cmd: "stat",
          args: ["-c", "%U:%G %a", "/home/alice/projects"],
          sudo: true,
        });
        expect((await stat.stdout()).trim()).toBe("alice:alice 770");
      });
    });

    // ─── File Isolation Between Users ───────────────────────────────

    describe("file isolation", () => {
      it("user A cannot read user B's files via runCommand", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");

        await alice.writeFiles([
          { path: "secret.txt", content: Buffer.from("alice's secret") },
        ]);

        const cat = await bob.runCommand({
          cmd: "cat",
          args: ["/home/alice/secret.txt"],
        });
        expect(cat.exitCode).not.toBe(0);
        expect(await cat.stderr()).toContain("Permission denied");
      });

      it("user A cannot list user B's home directory", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");

        const ls = await bob.runCommand({
          cmd: "ls",
          args: ["/home/alice"],
        });
        expect(ls.exitCode).not.toBe(0);
        expect(await ls.stderr()).toContain("Permission denied");
      });

      it("user A cannot write to user B's home directory", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");

        const touch = await bob.runCommand({
          cmd: "touch",
          args: ["/home/alice/hacked.txt"],
        });
        expect(touch.exitCode).not.toBe(0);
      });

      it("user A cannot execute in user B's home directory", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");

        await alice.writeFiles([
          {
            path: "script.sh",
            content: Buffer.from("#!/bin/bash\necho pwned"),
            mode: 0o755,
          },
        ]);

        const exec = await bob.runCommand({
          cmd: "/home/alice/script.sh",
        });
        expect(exec.exitCode).not.toBe(0);
      });

      it("SandboxUser can read its own files but not other users' files", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");

        await alice.writeFiles([
          { path: "alice.txt", content: Buffer.from("alice data") },
        ]);
        await bob.writeFiles([
          { path: "bob.txt", content: Buffer.from("bob data") },
        ]);

        // Each user can read their own files via SandboxUser.readFileToBuffer
        const aliceContent = await alice.readFileToBuffer({
          path: "alice.txt",
        });
        const bobContent = await bob.readFileToBuffer({
          path: "bob.txt",
        });

        expect(aliceContent?.toString()).toBe("alice data");
        expect(bobContent?.toString()).toBe("bob data");

        // The sandbox HTTP API can also read all users' files (home dirs
        // are group-owned by vercel-sandbox)
        const aliceViaSandbox = await sandbox.readFileToBuffer({
          path: "/home/alice/alice.txt",
        });
        expect(aliceViaSandbox?.toString()).toBe("alice data");

        // Bob cannot read alice's file via runCommand (inter-user isolation)
        const cat = await bob.runCommand({
          cmd: "cat",
          args: ["/home/alice/alice.txt"],
        });
        expect(cat.exitCode).not.toBe(0);
      });
    });

    // ─── Group Management ───────────────────────────────────────────

    describe("createGroup", () => {
      it("creates a group with a shared directory", async () => {
        const devs = await sandbox.createGroup("devs");

        expect(devs.groupname).toBe("devs");
        expect(devs.sharedDir).toBe("/shared/devs");

        const exists = await sandbox.runCommand({
          cmd: "test",
          args: ["-d", "/shared/devs"],
          sudo: true,
        });
        expect(exists.exitCode).toBe(0);
      });

      it("sets setgid (2770) on the shared directory", async () => {
        await sandbox.createGroup("devs");

        const stat = await sandbox.runCommand({
          cmd: "stat",
          args: ["-c", "%a", "/shared/devs"],
          sudo: true,
        });
        expect((await stat.stdout()).trim()).toBe("2770");
      });

      it("shared dir is owned by vercel-sandbox:<groupname>", async () => {
        await sandbox.createGroup("devs");

        const stat = await sandbox.runCommand({
          cmd: "stat",
          args: ["-c", "%U:%G", "/shared/devs"],
          sudo: true,
        });
        expect((await stat.stdout()).trim()).toBe("vercel-sandbox:devs");
      });
    });

    // ─── Group Access Control ───────────────────────────────────────

    describe("group file sharing", () => {
      it("group member can write to shared directory", async () => {
        const alice = await sandbox.createUser("alice");
        await sandbox.createGroup("devs");
        await sandbox.addUserToGroup("alice", "devs");

        const touch = await alice.runCommand({
          cmd: "touch",
          args: ["/shared/devs/from-alice.txt"],
        });
        expect(touch.exitCode).toBe(0);
      });

      it("files in shared dir inherit group ownership (setgid)", async () => {
        const alice = await sandbox.createUser("alice");
        await sandbox.createGroup("devs");
        await sandbox.addUserToGroup("alice", "devs");

        await alice.runCommand({
          cmd: "touch",
          args: ["/shared/devs/file.txt"],
        });

        const stat = await sandbox.runCommand({
          cmd: "stat",
          args: ["-c", "%G", "/shared/devs/file.txt"],
          sudo: true,
        });
        expect((await stat.stdout()).trim()).toBe("devs");
      });

      it("non-member cannot access shared directory", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");
        await sandbox.createGroup("devs");
        await sandbox.addUserToGroup("alice", "devs");
        // bob is NOT in devs

        const ls = await bob.runCommand({
          cmd: "ls",
          args: ["/shared/devs"],
        });
        expect(ls.exitCode).not.toBe(0);
        expect(await ls.stderr()).toContain("Permission denied");
      });

      it("two group members can read each other's files in shared dir", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");
        await sandbox.createGroup("devs");
        await sandbox.addUserToGroup("alice", "devs");
        await sandbox.addUserToGroup("bob", "devs");

        // Alice creates a file
        await alice.runCommand({
          cmd: "bash",
          args: [
            "-c",
            'echo "shared data" > /shared/devs/collab.txt',
          ],
        });

        // Bob reads it
        const cat = await bob.runCommand({
          cmd: "cat",
          args: ["/shared/devs/collab.txt"],
        });
        expect(cat.exitCode).toBe(0);
        expect((await cat.stdout()).trim()).toBe("shared data");
      });

      it("removed member loses access to shared directory", async () => {
        const alice = await sandbox.createUser("alice");
        await sandbox.createGroup("devs");
        await sandbox.addUserToGroup("alice", "devs");

        // Verify access works
        const touch = await alice.runCommand({
          cmd: "touch",
          args: ["/shared/devs/test.txt"],
        });
        expect(touch.exitCode).toBe(0);

        // Remove from group
        await sandbox.removeUserFromGroup("alice", "devs");

        // Access should fail now
        const ls = await alice.runCommand({
          cmd: "ls",
          args: ["/shared/devs"],
        });
        expect(ls.exitCode).not.toBe(0);
      });
    });

    // ─── Convenience Methods ────────────────────────────────────────

    describe("SandboxUser convenience methods", () => {
      it("addToGroup adds the user to a group", async () => {
        const alice = await sandbox.createUser("alice");
        await sandbox.createGroup("devs");

        await alice.addToGroup("devs");

        const groups = await alice.runCommand("groups");
        expect(await groups.stdout()).toContain("devs");
      });

      it("removeFromGroup removes the user from a group", async () => {
        const alice = await sandbox.createUser("alice");
        await sandbox.createGroup("devs");
        await alice.addToGroup("devs");
        await alice.removeFromGroup("devs");

        const groups = await sandbox.runCommand({
          cmd: "groups",
          args: ["alice"],
          sudo: true,
        });
        expect(await groups.stdout()).not.toContain("devs");
      });
    });

    // ─── Multi-Group Isolation ──────────────────────────────────────

    describe("multi-group isolation", () => {
      it("user in group A but not group B cannot access group B's shared dir", async () => {
        const alice = await sandbox.createUser("alice");
        await sandbox.createGroup("frontend");
        await sandbox.createGroup("backend");
        await sandbox.addUserToGroup("alice", "frontend");
        // alice is NOT in backend

        const touchFE = await alice.runCommand({
          cmd: "touch",
          args: ["/shared/frontend/fe-file.txt"],
        });
        expect(touchFE.exitCode).toBe(0);

        const touchBE = await alice.runCommand({
          cmd: "touch",
          args: ["/shared/backend/be-file.txt"],
        });
        expect(touchBE.exitCode).not.toBe(0);
      });

      it("user in multiple groups can access all their shared dirs", async () => {
        const alice = await sandbox.createUser("alice");
        await sandbox.createGroup("frontend");
        await sandbox.createGroup("backend");
        await sandbox.addUserToGroup("alice", "frontend");
        await sandbox.addUserToGroup("alice", "backend");

        const touchFE = await alice.runCommand({
          cmd: "touch",
          args: ["/shared/frontend/fe-file.txt"],
        });
        const touchBE = await alice.runCommand({
          cmd: "touch",
          args: ["/shared/backend/be-file.txt"],
        });
        expect(touchFE.exitCode).toBe(0);
        expect(touchBE.exitCode).toBe(0);
      });
    });

    // ─── Process Isolation ──────────────────────────────────────────

    describe("process isolation", () => {
      it("user commands run with correct user identity", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");

        const aliceId = await alice.runCommand("id");
        const bobId = await bob.runCommand("id");

        const aliceOutput = await aliceId.stdout();
        const bobOutput = await bobId.stdout();

        expect(aliceOutput).toContain("(alice)");
        expect(aliceOutput).not.toContain("(bob)");
        expect(bobOutput).toContain("(bob)");
        expect(bobOutput).not.toContain("(alice)");
      });

      it("user cannot kill another user's process", async () => {
        const alice = await sandbox.createUser("alice");
        const bob = await sandbox.createUser("bob");

        // Alice starts a long-running process
        const aliceProc = await alice.runCommand({
          cmd: "sleep",
          args: ["300"],
          detached: true,
        });

        // Get the PID of alice's sleep process
        const pgrep = await sandbox.runCommand({
          cmd: "pgrep",
          args: ["-u", "alice", "sleep"],
          sudo: true,
        });
        const pid = (await pgrep.stdout()).trim();

        // Bob tries to kill it
        const kill = await bob.runCommand({
          cmd: "kill",
          args: [pid],
        });
        expect(kill.exitCode).not.toBe(0);

        // Clean up
        await aliceProc.kill("SIGTERM");
        await aliceProc.wait();
      });

      it("created user does not have in-guest sudo access", async () => {
        const alice = await sandbox.createUser("alice");

        // alice should not be able to run sudo inside the sandbox
        const sudoAttempt = await alice.runCommand({
          cmd: "sudo",
          args: ["whoami"],
        });
        // sudo should fail — only vercel-sandbox has passwordless sudo
        expect(sudoAttempt.exitCode).not.toBe(0);
      });
    });
  },
);
