import { Bash } from "just-bash";
import { describe, expect, test } from "vitest";
import { buildUserCommands } from "./user-commands";
import { createUserState } from "./registry";

function makeBash() {
  const state = createUserState();
  const bash = new Bash({ customCommands: buildUserCommands(state) });
  return { state, bash };
}

describe("user/group commands", () => {
  describe("id", () => {
    test("reports the default user and group when no target is given", async () => {
      const { bash } = makeBash();
      expect((await bash.exec("id -un")).stdout.trim()).toBe("vercel-sandbox");
      expect((await bash.exec("id -gn")).stdout.trim()).toBe("vercel-sandbox");
    });

    test("root always exists with group root", async () => {
      const { bash } = makeBash();
      expect((await bash.exec("id -gn root")).stdout.trim()).toBe("root");
    });

    test("unknown users fail", async () => {
      const { bash } = makeBash();
      const result = await bash.exec("id -un ghost");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no such user");
    });
  });

  describe("useradd", () => {
    test("registers the user with a primary group named after them", async () => {
      const { state, bash } = makeBash();
      expect((await bash.exec("useradd -s /bin/bash alice")).exitCode).toBe(0);
      expect(state.users.get("alice")).toEqual({ group: "alice" });
      expect(state.groups.get("alice")).toEqual(new Set(["alice"]));
    });

    test("-m creates the home directory", async () => {
      const { bash } = makeBash();
      await bash.exec("useradd -m alice");
      expect((await bash.exec("ls /home")).stdout).toContain("alice");
    });

    test("fails without a username and on duplicates", async () => {
      const { bash } = makeBash();
      expect((await bash.exec("useradd")).exitCode).toBe(1);
      await bash.exec("useradd alice");
      const dup = await bash.exec("useradd alice");
      expect(dup.exitCode).toBe(9);
      expect(dup.stderr).toContain("already exists");
    });
  });

  describe("groupadd", () => {
    test("creates an empty group; duplicates and missing operand fail", async () => {
      const { state, bash } = makeBash();
      expect((await bash.exec("groupadd devs")).exitCode).toBe(0);
      expect(state.groups.get("devs")).toEqual(new Set());
      expect((await bash.exec("groupadd devs")).exitCode).toBe(9);
      expect((await bash.exec("groupadd")).exitCode).toBe(1);
    });
  });

  describe("usermod / gpasswd", () => {
    test("adds and removes group members", async () => {
      const { state, bash } = makeBash();
      await bash.exec("useradd alice");
      await bash.exec("groupadd devs");
      expect((await bash.exec("usermod -aG devs alice")).exitCode).toBe(0);
      expect(state.groups.get("devs")).toEqual(new Set(["alice"]));
      expect((await bash.exec("gpasswd -d alice devs")).exitCode).toBe(0);
      expect(state.groups.get("devs")).toEqual(new Set());
    });

    test("usermod fails on unknown group or user with exit code 6", async () => {
      const { bash } = makeBash();
      await bash.exec("useradd alice");
      await bash.exec("groupadd devs");
      expect((await bash.exec("usermod -aG nope alice")).exitCode).toBe(6);
      expect((await bash.exec("usermod -aG devs ghost")).exitCode).toBe(6);
    });

    test("gpasswd fails on unknown group and non-members", async () => {
      const { bash } = makeBash();
      await bash.exec("useradd alice");
      await bash.exec("groupadd devs");
      expect((await bash.exec("gpasswd -d alice nope")).exitCode).toBe(1);
      expect((await bash.exec("gpasswd -d alice devs")).exitCode).toBe(3);
    });
  });

  test("chown is accepted as a no-op", async () => {
    const { bash } = makeBash();
    expect((await bash.exec("chown alice:alice /tmp")).exitCode).toBe(0);
  });
});
