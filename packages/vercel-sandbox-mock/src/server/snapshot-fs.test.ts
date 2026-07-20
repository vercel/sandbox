import { InMemoryFs } from "just-bash";
import { describe, expect, test } from "vitest";
import { captureFileSystem, restoreFileSystem } from "./snapshot-fs";

async function seed(fs: InMemoryFs): Promise<void> {
  await fs.mkdir("/tree/nested", { recursive: true });
  await fs.writeFile("/tree/nested/payload.bin", Buffer.from([0x00, 0xff, 0x80]));
  await fs.writeFile("/tree/run.sh", "#!/bin/sh\necho hi\n");
  await fs.chmod("/tree/run.sh", 0o755);
  await fs.symlink("nested/payload.bin", "/tree/link");
}

describe("captureFileSystem / restoreFileSystem", () => {
  test("round-trips files, directories, symlinks, and modes", async () => {
    const source = new InMemoryFs();
    await seed(source);

    const entries = await captureFileSystem(source);
    const target = new InMemoryFs();
    await restoreFileSystem(entries, target);

    expect(Buffer.from(await target.readFileBuffer("/tree/nested/payload.bin"))).toEqual(
      Buffer.from([0x00, 0xff, 0x80]),
    );
    expect((await target.lstat("/tree/run.sh")).mode & 0o777).toBe(0o755);
    expect((await target.lstat("/tree/link")).isSymbolicLink).toBe(true);
    expect(await target.readlink("/tree/link")).toBe("nested/payload.bin");
    expect((await target.lstat("/tree/nested")).isDirectory).toBe(true);
  });

  test("capture skips the root path", async () => {
    const entries = await captureFileSystem(new InMemoryFs());
    expect(entries.map((e) => e.path)).not.toContain("/");
  });

  test("restore overwrites existing files and symlinks in the target", async () => {
    const source = new InMemoryFs();
    await seed(source);
    const entries = await captureFileSystem(source);

    const target = new InMemoryFs();
    await target.mkdir("/tree", { recursive: true });
    await target.writeFile("/tree/run.sh", "stale");
    await target.symlink("elsewhere", "/tree/link");
    await restoreFileSystem(entries, target);

    expect(await target.readFile("/tree/run.sh", "utf8")).toBe("#!/bin/sh\necho hi\n");
    expect(await target.readlink("/tree/link")).toBe("nested/payload.bin");
  });
});
