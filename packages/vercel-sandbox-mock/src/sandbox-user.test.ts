import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Sandbox } from "./sandbox";

const userName = () => `u${randomUUID().slice(0, 8).replace(/-/g, "")}`;

describe("SandboxUser (real SDK over mock fetch)", () => {
  let sandbox: Sandbox;
  beforeAll(async () => {
    sandbox = await Sandbox.create({ name: `user-${randomUUID().slice(0, 8)}` });
  });
  afterAll(async () => {
    await sandbox.stop();
  });

  test("createUser scopes commands and files to the home directory", async () => {
    const name = userName();
    const user = await sandbox.createUser(name);
    expect(user.username).toBe(name);
    expect(user.homeDir).toBe(`/home/${name}`);

    const pwd = await user.runCommand("pwd");
    expect((await pwd.stdout()).trim()).toBe(`/home/${name}`);

    await user.writeFiles([{ path: "note.txt", content: "mine" }]);
    const buf = await user.readFileToBuffer({ path: "note.txt" });
    expect(buf?.toString()).toBe("mine");
  });

  test("asUser returns a handle without creating the user", async () => {
    const root = sandbox.asUser("root");
    expect(root.username).toBe("root");
    expect(root.homeDir).toBe("/root");
  });

  test("group creation and membership round-trip", async () => {
    const name = userName();
    const group = `g${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const user = await sandbox.createUser(name);
    const { sharedDir } = await sandbox.createGroup(group);
    expect(sharedDir).toBe(`/shared/${group}`);

    await user.addToGroup(group);
    await user.removeFromGroup(group);
  });

  test("invalid names are rejected", async () => {
    await expect(sandbox.createUser("Invalid")).rejects.toThrow();
    await expect(sandbox.createGroup("bad name")).rejects.toThrow();
  });

  test("duplicate user creation fails", async () => {
    const name = userName();
    await sandbox.createUser(name);
    await expect(sandbox.createUser(name)).rejects.toThrow();
  });
});
