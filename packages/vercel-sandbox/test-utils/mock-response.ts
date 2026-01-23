export function createNdjsonStream(
  lines: object[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const ndjson = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(ndjson));
      controller.close();
    },
  });
}
