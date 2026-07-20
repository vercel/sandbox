import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Sandbox } from "../src/sandbox";

describe("FileSystem (real SDK over mock fetch)", () => {
  let sandbox: Sandbox;
  let root: string;
  beforeAll(async () => {
    sandbox = await Sandbox.create({ name: `fs-${randomUUID().slice(0, 8)}` });
  });
  afterAll(async () => {
    await sandbox.stop();
  });

  test("writeFile/readFile round-trips with encodings", async () => {
    root = `/tmp/fs-${randomUUID().slice(0, 8)}`;
    await sandbox.fs.mkdir(root, { recursive: true });
    await sandbox.fs.writeFile(`${root}/text.txt`, "héllo");
    expect(await sandbox.fs.readFile(`${root}/text.txt`, "utf8")).toBe("héllo");
    expect(await sandbox.fs.readFile(`${root}/text.txt`)).toEqual(Buffer.from("héllo"));
  });

  test("appendFile appends", async () => {
    await sandbox.fs.writeFile(`${root}/log`, "a");
    await sandbox.fs.appendFile(`${root}/log`, "b");
    expect(await sandbox.fs.readFile(`${root}/log`, "utf8")).toBe("ab");
  });

  test("exists reflects presence; missing reads throw ENOENT", async () => {
    expect(await sandbox.fs.exists(`${root}/text.txt`)).toBe(true);
    expect(await sandbox.fs.exists(`${root}/missing`)).toBe(false);
    await expect(sandbox.fs.readFile(`${root}/missing`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rm recursive removes a tree", async () => {
    await sandbox.fs.mkdir(`${root}/sub/deep`, { recursive: true });
    await sandbox.fs.writeFile(`${root}/sub/deep/f`, "x");
    await sandbox.fs.rm(`${root}/sub`, { recursive: true });
    expect(await sandbox.fs.exists(`${root}/sub`)).toBe(false);
  });
});
