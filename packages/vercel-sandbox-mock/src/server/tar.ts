import zlib from "node:zlib";
import { Readable } from "node:stream";
import { extract, type Headers as TarHeaders } from "tar-stream";

export interface TarEntry {
  name: string;
  mode: number | undefined;
  content: Buffer;
}

/**
 * Reverse of the SDK's `FileWriter`: the `fs/write` endpoint receives a gzipped
 * tar archive (`content-type: application/gzip`). Gunzip and untar it into a
 * flat list of entries the caller writes into the in-memory filesystem.
 */
export async function extractTarGz(body: Buffer): Promise<TarEntry[]> {
  const tarball = zlib.gunzipSync(body);
  const entries: TarEntry[] = [];
  const extractor = extract();

  await new Promise<void>((resolve, reject) => {
    extractor.on(
      "entry",
      (header: TarHeaders, stream: Readable, next: (err?: unknown) => void) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          if (header.type === "file") {
            entries.push({
              name: header.name,
              mode: header.mode,
              content: Buffer.concat(chunks),
            });
          }
          next();
        });
        stream.on("error", next);
        stream.resume();
      },
    );
    extractor.on("finish", resolve);
    extractor.on("error", reject);
    Readable.from(tarball).pipe(extractor);
  });

  return entries;
}
