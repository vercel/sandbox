/**
 * Build the newline-delimited JSON streaming responses the SDK expects from
 * `runCommand({ wait: true })` and `getLogs`. The SDK checks the content-type
 * is exactly `application/x-ndjson`, then parses the body one JSON object per
 * line with the `jsonlines` package.
 *
 * just-bash buffers command output (it has no live streaming), so every line
 * is known up front — we emit them all, then close the stream.
 */
export function ndjson(lines: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}
