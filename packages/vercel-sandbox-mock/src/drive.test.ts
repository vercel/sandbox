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

    expect(drive.name).toBe("cache");
    expect(drive.region).toBe("sfo1");
    expect(drive.maxSize).toBe(1024);

    const result = await Drive.list();
    expect(result.drives).toHaveLength(1);
    expect(result.drives[0].name).toBe("cache");
    expect(result.drives[0].region).toBe("sfo1");

    await drive.delete();
    await expect(Drive.list().then(({ drives }) => drives)).resolves.toEqual(
      [],
    );
  });

  test("uses the default region", async () => {
    const drive = await Drive.getOrCreate({ name: "cache" });

    expect(drive.region).toBe("iad1");
  });
});
