import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { Sandbox as MockSandbox } from "./sandbox";
import { Snapshot as MockSnapshot } from "./stubs";

export async function expectForkToPreserveSnapshotFileSystem(
  Sandbox: typeof MockSandbox,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const source = await Sandbox.create({ name: `fork-source-${suffix}` });
  let fork: MockSandbox | undefined;
  let snapshot: MockSnapshot | undefined;
  try {
    const binary = Buffer.from([0x00, 0xff, 0x80, 0x41]);
    await source.fs.mkdir("/tmp/tree/nested", { recursive: true });
    await source.fs.writeFile("/tmp/tree/nested/payload.bin", binary);
    await source.fs.writeFile("/tmp/tree/run.sh", "#!/bin/sh\necho snapshot\n");
    await source.fs.chmod("/tmp/tree/run.sh", 0o755);
    await source.fs.symlink("nested/payload.bin", "/tmp/tree/payload-link");
    snapshot = await source.snapshot();

    await source.fs.writeFile("/tmp/tree/nested/payload.bin", "mutated");
    await source.fs.chmod("/tmp/tree/run.sh", 0o644);
    await source.fs.unlink("/tmp/tree/payload-link");
    await source.fs.writeFile("/tmp/tree/after-snapshot.txt", "new");

    fork = await Sandbox.fork({
      sourceSandbox: source.name,
      name: `fork-target-${suffix}`,
    });

    expect(await fork.fs.readFile("/tmp/tree/nested/payload.bin")).toEqual(binary);
    expect((await fork.fs.stat("/tmp/tree/run.sh")).mode & 0o777).toBe(0o755);
    expect((await fork.fs.lstat("/tmp/tree/payload-link")).isSymbolicLink()).toBe(true);
    expect(await fork.fs.readlink("/tmp/tree/payload-link")).toBe("nested/payload.bin");
    expect(await fork.fs.readFile("/tmp/tree/payload-link")).toEqual(binary);
    expect(await fork.fs.exists("/tmp/tree/after-snapshot.txt")).toBe(false);
  } finally {
    await Promise.allSettled([fork?.delete(), snapshot?.delete(), source.delete()]);
  }
}
