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
