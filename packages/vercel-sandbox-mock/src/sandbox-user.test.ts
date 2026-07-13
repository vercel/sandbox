import { afterEach, describe, expect, test } from "vitest";
import { Sandbox } from "./sandbox";
import { SandboxUser } from "./sandbox-user";
import { setupSandbox } from "./handlers";

const server = setupSandbox();

describe("multi-user and groups", () => {
  afterEach(() => server.resetHandlers());

  test("createUser returns a SandboxUser scoped to its home directory", async () => {
    const sandbox = await Sandbox.create();
    const alice = await sandbox.createUser("alice");

    expect(alice).toBeInstanceOf(SandboxUser);
    expect(alice.username).toBe("alice");
    expect(alice.homeDir).toBe("/home/alice");

    // Commands default to running in the user's home directory.
    const pwd = await alice.runCommand("pwd");
    expect((await pwd.stdout()).trim()).toBe("/home/alice");

    // $HOME is set for the user.
    const home = await alice.runCommand("sh", ["-c", "echo $HOME"]);
    expect((await home.stdout()).trim()).toBe("/home/alice");

    await sandbox.stop();
  });

  test("asUser('root') maps to /root", async () => {
    const sandbox = await Sandbox.create();
    const root = sandbox.asUser("root");
    expect(root.homeDir).toBe("/root");
    await sandbox.stop();
  });

  test("user file operations resolve relative paths under the home dir", async () => {
    const sandbox = await Sandbox.create();
    const alice = await sandbox.createUser("alice");

    await alice.writeFiles([{ path: "note.txt", content: "hello" }]);

    // Readable both through the user handle (relative) and the sandbox (absolute).
    const viaUser = await alice.readFileToBuffer({ path: "note.txt" });
    expect(viaUser?.toString()).toBe("hello");

    const viaSandbox = await sandbox.readFileToBuffer({ path: "/home/alice/note.txt" });
    expect(viaSandbox?.toString()).toBe("hello");

    await sandbox.stop();
  });

  test("createGroup creates a shared directory", async () => {
    const sandbox = await Sandbox.create();
    const group = await sandbox.createGroup("devs");
    expect(group).toEqual({ groupname: "devs", sharedDir: "/shared/devs" });
    expect(await sandbox.fs.exists("/shared/devs")).toBe(true);
    await sandbox.stop();
  });

  test("group membership round-trips via sandbox and user handles", async () => {
    const sandbox = await Sandbox.create();
    const alice = await sandbox.createUser("alice");
    await sandbox.createGroup("devs");

    await sandbox.addUserToGroup("alice", "devs");
    await alice.removeFromGroup("devs");

    // Removing again fails — she is no longer a member.
    await expect(alice.removeFromGroup("devs")).rejects.toThrow(/not a member/);
    await sandbox.stop();
  });

  test("duplicate users and groups are rejected", async () => {
    const sandbox = await Sandbox.create();
    await sandbox.createUser("alice");
    await sandbox.createGroup("devs");

    await expect(sandbox.createUser("alice")).rejects.toThrow(/already exists/);
    await expect(sandbox.createGroup("devs")).rejects.toThrow(/already exists/);
    await sandbox.stop();
  });

  test("invalid names are rejected before any side effects", async () => {
    const sandbox = await Sandbox.create();
    await expect(sandbox.createUser("Alice")).rejects.toThrow(/Invalid username/);
    await expect(sandbox.createUser("a".repeat(33))).rejects.toThrow(/at most 32/);
    await expect(sandbox.createGroup("bad group")).rejects.toThrow(/Invalid group name/);
    await expect(sandbox.addUserToGroup("alice", "ghost")).rejects.toThrow(
      /does not exist/,
    );
    await sandbox.stop();
  });

  test("getDefaultUser resolves and memoizes", async () => {
    const sandbox = await Sandbox.create();
    const a = await sandbox.getDefaultUser();
    const b = await sandbox.getDefaultUser();
    expect(a.username).toBeTruthy();
    expect(a).toEqual(b);
    await sandbox.stop();
  });

  // INCONSISTENCY: just-bash has no real Linux users. `whoami` reports the
  // underlying shell user and `$USER` is not propagated into `bash -c`
  // subshells, so true user identity only holds against a real sandbox.
  test.skip("INCONSISTENCY: whoami reflects the user identity", () => {});
});
