import zlib from "node:zlib";
import { describe, expect, test } from "vitest";
import { pack } from "tar-stream";
import { extractTarGz } from "./tar";

function gzipTar(files: { name: string; content: Buffer; mode?: number }[]): Promise<Buffer> {
  const p = pack();
  for (const f of files) p.entry({ name: f.name, mode: f.mode }, f.content);
  p.finalize();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gzip = p.pipe(zlib.createGzip());
    gzip.on("data", (c: Buffer) => chunks.push(c));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
  });
}

describe("extractTarGz", () => {
  test("round-trips file names, content, and modes", async () => {
    const body = await gzipTar([
      { name: "tmp/a.txt", content: Buffer.from("hello") },
      { name: "tmp/nested/b.bin", content: Buffer.from([0, 255, 128]), mode: 0o755 },
    ]);
    const entries = await extractTarGz(body);
    const byName = new Map(entries.map((e) => [e.name, e]));

    expect(byName.get("tmp/a.txt")?.content.toString()).toBe("hello");
    expect([...(byName.get("tmp/nested/b.bin")?.content ?? [])]).toEqual([0, 255, 128]);
    expect(byName.get("tmp/nested/b.bin")?.mode).toBe(0o755);
  });

  test("preserves binary content exactly", async () => {
    const content = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41]);
    const [entry] = await extractTarGz(await gzipTar([{ name: "bin", content }]));
    expect(entry.content).toEqual(content);
  });
});
