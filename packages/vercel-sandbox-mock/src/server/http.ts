/**
 * Small helpers for building the `Response` objects the mocked `fetch`
 * returns. The real SDK's `parseOrThrow` reads `response.text()` then
 * `JSON.parse`, treats any non-2xx as an error (storing the parsed body on
 * `APIError.json`), and validates 2xx bodies against a zod schema — so success
 * bodies must be valid JSON matching the validator, and error bodies must be
 * JSON with the shape `{ error: { code, message } }` the SDK inspects.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** An empty `{}` body — the shape `EmptyResponse` expects. */
export function empty(): Response {
  return json({});
}

/**
 * A non-2xx JSON error. `code`/`message` land on `APIError.json.error`, which
 * the SDK reads to drive control flow (`snapshot_not_found`, `sandbox_stopping`,
 * ...). Statuses 404/410/422 are surfaced immediately (not retried); 429/5xx
 * would trigger the SDK's retry loop, so they are never returned here.
 */
export function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}
