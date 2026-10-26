import { NotOk } from "./error.js";

export interface ApiAuth {
  token: string;
  /** Optional fetch implementation, for example to add headers per request. */
  fetch?: typeof globalThis.fetch;
}

export async function fetchApi(
  opts: ApiAuth & {
    endpoint: string;
    method?: string;
    body?: string;
  },
): Promise<unknown> {
  const fetch = opts.fetch ?? globalThis.fetch;
  const x = await fetch(`https://vercel.com/api${opts.endpoint}`, {
    method: opts.method,
    body: opts.body,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
  });
  if (!x.ok) {
    let message = await x.text();

    try {
      const { error } = JSON.parse(message);
      message = `${error.code.toUpperCase()}: ${error.message}`;
    } catch {}

    throw new NotOk({
      responseText: message,
      statusCode: x.status,
    });
  }
  return (await x.json()) as unknown;
}
