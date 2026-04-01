import { describe, it, expect } from "vitest";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import zlib from "zlib";
import tar from "tar-stream";
import { FileWriter } from "./file-writer.js";

async function extractFiles(readable: Readable) {
  const extract = tar.extract();
  const files = new Map<string, Buffer>();

  extract.on("entry", (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      files.set(header.name, Buffer.concat(chunks));
      next();
    });
  });

  await pipeline(readable, zlib.createGunzip(), extract);
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

  it("writes string content", async () => {
    const writer = new FileWriter();
    await writer.addFile({
      name: "hello.txt",
      content: "Hello world",
    });
    writer.end();

    const files = await extractFiles(writer.readable);
    expect(files.get("hello.txt")?.toString()).toBe("Hello world");
  });

  it("writes multi-byte UTF-8 string content", async () => {
    const writer = new FileWriter();
    const content = "café ☕ — Grüße aus München 🌍 日本語テスト";
    await writer.addFile({
      name: "utf8.txt",
      content,
    });
    writer.end();

    const files = await extractFiles(writer.readable);
    expect(files.get("utf8.txt")?.toString()).toBe(content);
  });

  it("writes Uint8Array content", async () => {
    const writer = new FileWriter();
    const content = new TextEncoder().encode("Hello world");
    await writer.addFile({
      name: "hello.txt",
      content,
    });
    writer.end();

    const files = await extractFiles(writer.readable);
    expect(files.get("hello.txt")?.toString()).toBe("Hello world");
  });

  it("writes multi-byte UTF-8 Uint8Array content", async () => {
    const writer = new FileWriter();
    const text = "café ☕ — Grüße aus München 🌍 日本語テスト";
    const content = new TextEncoder().encode(text);
    await writer.addFile({
      name: "utf8.txt",
      content,
    });
    writer.end();

    const files = await extractFiles(writer.readable);
    expect(files.get("utf8.txt")?.toString()).toBe(text);
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
