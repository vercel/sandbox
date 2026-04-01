import { describe, it, expect } from "vitest";
import { Readable } from "stream";
import zlib from "zlib";
import tar from "tar-stream";
import { FileWriter } from "./file-writer.js";

async function extractFiles(
  readable: Readable,
): Promise<Map<string, Buffer>> {
  const gunzip = zlib.createGunzip();
  const extract = tar.extract();
  const files = new Map<string, Buffer>();

  const done = new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        files.set(header.name, Buffer.concat(chunks));
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
  });

  readable.pipe(gunzip).pipe(extract);
  await done;
  return files;
}

describe("FileWriter", () => {
  it("writes ASCII buffer content", async () => {
    const writer = new FileWriter();
    await writer.addFile({
      name: "hello.txt",
      content: Buffer.from("Hello world"),
    });
    writer.end();

    const files = await extractFiles(writer.readable);
    expect(files.get("hello.txt")?.toString()).toBe("Hello world");
  });

  it("writes multi-byte UTF-8 buffer content", async () => {
    const writer = new FileWriter();
    const content = "café ☕ — Grüße aus München 🌍 日本語テスト";
    await writer.addFile({
      name: "utf8.txt",
      content: Buffer.from(content),
    });
    writer.end();

    const files = await extractFiles(writer.readable);
    expect(files.get("utf8.txt")?.toString()).toBe(content);
  });

  it("writes multiple files", async () => {
    const writer = new FileWriter();
    await writer.addFile({
      name: "a.txt",
      content: Buffer.from("file a"),
    });
    await writer.addFile({
      name: "b.txt",
      content: Buffer.from("file b"),
    });
    writer.end();

    const files = await extractFiles(writer.readable);
    expect(files.size).toBe(2);
    expect(files.get("a.txt")?.toString()).toBe("file a");
    expect(files.get("b.txt")?.toString()).toBe("file b");
  });

  it("writes stream content with explicit size", async () => {
    const content = Buffer.from("streamed content");
    const writer = new FileWriter();
    await writer.addFile({
      name: "stream.txt",
      content: Readable.from(content),
      size: content.length,
    });
    writer.end();

    const files = await extractFiles(writer.readable);
    expect(files.get("stream.txt")?.toString()).toBe("streamed content");
  });
});
