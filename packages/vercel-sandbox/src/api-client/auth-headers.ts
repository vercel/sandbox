/**
 * Builds the headers that authenticate one API request, such as
 * `authorization` and a DPoP proof (RFC 9449), which is signed for one method
 * and URL. It's called for every request, retries included. `url` is the full
 * request URL, query included.
 *
 * `onResponse`, if set, is given every response's headers, so a DPoP proof
 * can carry the server's latest `DPoP-Nonce`.
 */
export interface AuthHeadersProvider {
  (
    method: string,
    url: string,
  ): Record<string, string> | Promise<Record<string, string>>;
  onResponse?(url: string, headers: { get(name: string): string | null }): void;
}

/**
 * Wrap `fetch` so every call gets its headers from `getAuthHeaders`. When a
 * DPoP server rejects the proof for its nonce (a 401 with `use_dpop_nonce`
 * and a `DPoP-Nonce`), the request is sent once more with new headers, unless
 * its body is a stream that was already read.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9449.html#section-9
 */
export function withAuthHeaders(
  fetch: typeof globalThis.fetch,
  getAuthHeaders: AuthHeadersProvider,
): typeof globalThis.fetch {
  const send = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const authHeaders = await getAuthHeaders(init?.method ?? "GET", url);
    for (const [name, value] of Object.entries(authHeaders)) {
      headers.set(name, value);
    }
    const response = await fetch(url, { ...init, headers });
    getAuthHeaders.onResponse?.(url, response.headers);
    return response;
  };

  return async (input, init) => {
    const request = splitRequest(input, init);
    const response = await send(request.url, request.init);
    if (!isDpopNonceChallenge(response) || isStream(request.init?.body)) {
      return response;
    }
    await response.body?.cancel();
    return send(request.url, request.init);
  };
}

/**
 * `fetch` takes a URL or a `Request`. A `Request` has its own method,
 * headers, body and signal, and `init` overrides them, as in `fetch`. The
 * body of a `Request` is a stream, so such a request isn't sent again.
 */
function splitRequest(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: RequestInit,
): { url: string; init?: RequestInit } {
  if (!isRequest(input)) {
    return { url: String(input), init };
  }
  return {
    url: input.url,
    init: {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: input.signal,
      redirect: input.redirect,
      // Node.js needs this to send a stream body.
      ...(input.body ? { duplex: "half" } : {}),
      ...init,
    } as RequestInit,
  };
}

function isRequest(input: unknown): input is Request {
  return (
    typeof input === "object" &&
    input !== null &&
    "url" in input &&
    "method" in input &&
    "headers" in input
  );
}

function isDpopNonceChallenge(response: Response): boolean {
  return (
    response.status === 401 &&
    Boolean(response.headers.get("dpop-nonce")) &&
    /use_dpop_nonce/i.test(response.headers.get("www-authenticate") ?? "")
  );
}

function isStream(body: RequestInit["body"]): boolean {
  return (
    body instanceof ReadableStream ||
    (typeof body === "object" &&
      body !== null &&
      Symbol.asyncIterator in body &&
      !(body instanceof Uint8Array))
  );
}
