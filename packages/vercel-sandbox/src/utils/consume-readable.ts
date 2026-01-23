/**
 * Consumes a readable entirely concatenating all content in a single Buffer
 * @param readable A Readable stream
 */
export function consumeReadable(readable: NodeJS.ReadableStream) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on("error", (err) => reject(err));
    readable.on("data", (chunk) => chunks.push(chunk));
    readable.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
