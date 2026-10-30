/**
 * Build the newline-delimited JSON streaming responses the SDK expects from
 * `runCommand({ wait: true })` and `getLogs`. The SDK checks the content-type
 * is exactly `application/x-ndjson`, then parses the body one JSON object per
 * line with the `jsonlines` package.
 *
 * just-bash buffers command output (it has no live streaming), so every line
 * is known up front — we emit them all, then close the stream. `rest` holds
 * lines that are only known later, such as for a command waiting for stdin.
 */
export function ndjson(lines: unknown[], rest?: Promise<unknown[]>): Response {
  const encoder = new TextEncoder();
  const enqueue = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    batch: unknown[],
  ) => {
    for (const line of batch) {
      controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
    }
  };
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      enqueue(controller, lines);
      if (!rest) return controller.close();
      rest
        .then((later) => {
          if (cancelled) return;
          enqueue(controller, later);
          controller.close();
        })
        .catch((error) => {
          if (!cancelled) controller.error(error);
        });
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}
