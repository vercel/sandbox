import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readJsonPayload } from "../../src/util/managed-credentials-payload";
test("bounded JSON file input rejects oversized, invalid and non-file inputs without echoing contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sandbox-json-"));
  const file = join(dir, "config.json");
  try {
    await writeFile(file, '{"credentials":{"github":[]}}');
    expect(
      await readJsonPayload(file, "--credentials-from-config-file"),
    ).toEqual({ credentials: { github: [] } });
    for (const content of [
      Buffer.alloc(65537),
      Buffer.from([255]),
      Buffer.from("secret-invalid-json"),
    ]) {
      await writeFile(file, content);
      await expect(
        readJsonPayload(file, "--credentials-from-config-file"),
      ).rejects.toThrow();
      await expect(
        readJsonPayload(file, "--credentials-from-config-file"),
      ).rejects.not.toThrow("secret-invalid-json");
    }
    await expect(
      readJsonPayload(dir, "--credentials-from-config-file"),
    ).rejects.toThrow("regular JSON file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
