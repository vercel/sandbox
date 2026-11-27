import { NotOk } from "./error.js";
import {
  withAuthHeaders,
  type AuthHeadersProvider,
} from "../api-client/auth-headers.js";

export interface ApiAuth {
  token: string;
  /** Builds each request's auth headers, instead of `Bearer` with `token`. */
  getAuthHeaders?: AuthHeadersProvider;
}

export async function fetchApi(
  opts: ApiAuth & {
    endpoint: string;
    method?: string;
    body?: string;
  },
): Promise<unknown> {
  const send = opts.getAuthHeaders
    ? withAuthHeaders(fetch, opts.getAuthHeaders)
    : fetch;
  const x = await send(`https://vercel.com/api${opts.endpoint}`, {
    method: opts.method,
    body: opts.body,
    headers: {
      ...(!opts.getAuthHeaders && { Authorization: `Bearer ${opts.token}` }),
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
