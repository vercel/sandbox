import { afterEach, describe, expect, test } from "vitest";
import { Drive } from "./drive";
import { setupSandbox } from "./setup";

describe("Drive", () => {
  const server = setupSandbox();

  afterEach(() => server.resetHandlers());

  test("creates, lists, and deletes drives", async () => {
    const drive = await Drive.getOrCreate({
      name: "cache",
      region: "sfo1",
      maxSize: 1024,
    });

    expect(drive.driveId).toMatch(/^drive_/);
    expect(drive.name).toBe("cache");
    expect(drive.region).toBe("sfo1");
    expect(drive.maxSize).toBe(1024);

    const result = await Drive.list();
    expect(result.drives).toHaveLength(1);
    expect(result.drives[0].driveId).toBe(drive.driveId);
    expect(result.drives[0].name).toBe("cache");
    expect(result.drives[0].region).toBe("sfo1");

    await drive.delete();
    await expect(Drive.list().then(({ drives }) => drives)).resolves.toEqual(
      [],
    );
  });

  test("gets a drive by name without changing it", async () => {
    const original = await Drive.getOrCreate({
      name: "cache",
      region: "sfo1",
      maxSize: 1024,
    });
    const drive = await Drive.get({
      name: original.name,
    });

    expect(drive.driveId).toBe(original.driveId);
    expect(drive.name).toBe(original.name);
    expect(drive.region).toBe(original.region);
    expect(drive.maxSize).toBe(original.maxSize);
    expect(drive.updatedAt).toEqual(original.updatedAt);
    expect((await Drive.list()).drives).toHaveLength(1);
  });

  test("forks a drive and deletes the child without changing the parent", async () => {
    const parent = await Drive.getOrCreate({
      name: "cache",
      region: "sfo1",
      maxSize: 1024,
    });
    const child = await parent.fork({ name: "cache-child" });

    expect(child.driveId).not.toBe(parent.driveId);
    expect(child.name).toBe("cache-child");
    expect(child.projectId).toBe(parent.projectId);
    expect(child.region).toBe(parent.region);
    expect(child.maxSize).toBe(parent.maxSize);
    expect(child.parentDriveId).toBe(parent.driveId);
    expect(child.rootDriveId).toBe(parent.driveId);
    expect(child.currentSessionId).toBeUndefined();
    expect(child.currentSandboxName).toBeUndefined();
    expect(parent.name).toBe("cache");
    expect(parent.parentDriveId).toBeUndefined();
    expect((await Drive.get({ name: child.name })).driveId).toBe(child.driveId);
    expect((await Drive.list()).drives.map((drive) => drive.name)).toEqual([
      "cache",
      "cache-child",
    ]);

    await child.delete();

    const remainingParent = await Drive.get({ name: parent.name });
    expect(remainingParent.driveId).toBe(parent.driveId);
    expect(remainingParent.updatedAt).toEqual(parent.updatedAt);
    expect((await Drive.list()).drives).toHaveLength(1);
    await expect(Drive.get({ name: child.name })).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  test("keeps the root drive ID when forking a child", async () => {
    const parent = await Drive.getOrCreate({ name: "cache" });
    const child = await parent.fork({ name: "cache-child" });
    const storedChild = await Drive.get({ name: child.name });
    const grandchild = await storedChild.fork({ name: "cache-grandchild" });

    expect(grandchild.driveId).not.toBe(child.driveId);
    expect(grandchild.driveId).not.toBe(parent.driveId);
    expect(grandchild.parentDriveId).toBe(child.driveId);
    expect(grandchild.rootDriveId).toBe(parent.driveId);
  });

  test.each(["cache", "existing"])(
    "does not fork over an existing drive: %s",
    async (name) => {
      const parent = await Drive.getOrCreate({ name: "cache" });
      const existing = await Drive.getOrCreate({ name });

      await expect(parent.fork({ name })).rejects.toMatchObject({
        response: { status: 409 },
        json: { error: { code: "conflict" } },
      });
      expect((await Drive.get({ name })).driveId).toBe(existing.driveId);
      expect((await Drive.get({ name: parent.name })).driveId).toBe(
        parent.driveId,
      );
    },
  );

  test("does not fork a deleted drive", async () => {
    const parent = await Drive.getOrCreate({ name: "cache" });
    await parent.delete();

    await expect(parent.fork({ name: "cache-child" })).rejects.toMatchObject({
      response: { status: 404 },
      json: { error: { code: "not_found" } },
    });
    expect((await Drive.list()).drives).toHaveLength(0);
  });

  test("does not fork a drive from another project", async () => {
    const parent = await Drive.getOrCreate({ name: "cache" });
    const otherProjectDrive = await Drive.getOrCreate({
      name: parent.name,
      projectId: "prj_other",
    });

    await expect(
      otherProjectDrive.fork({ name: "cache-child" }),
    ).rejects.toMatchObject({
      response: { status: 404 },
      json: { error: { code: "not_found" } },
    });
    expect((await Drive.list()).drives).toHaveLength(1);
  });

  test.each(["missing", "drive_missing"])(
    "does not create a missing drive: %s",
    async (name) => {
      await expect(Drive.get({ name })).rejects.toMatchObject({
        response: { status: 404 },
        json: { error: { code: "not_found" } },
      });
      expect((await Drive.list()).drives).toHaveLength(0);
    },
  );

  test("does not get a deleted drive by name", async () => {
    const drive = await Drive.getOrCreate({ name: "cache" });
    await drive.delete();

    await expect(
      Drive.get({
        name: drive.name,
      }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  test("does not get a drive from another project by name", async () => {
    const drive = await Drive.getOrCreate({ name: "cache" });

    await expect(
      Drive.get({
        name: drive.name,
        projectId: "prj_other",
      }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  test("uses the default region", async () => {
    const drive = await Drive.getOrCreate({ name: "cache" });

    expect(drive.region).toBe("iad1");
  });
});
