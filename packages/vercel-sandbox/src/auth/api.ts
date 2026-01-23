import { NotOk } from "./error";

export async function fetchApi(opts: {
  token: string;
  endpoint: string;
  method?: string;
  body?: string;
}): Promise<unknown> {
  const x = await fetch(`https://api.vercel.com${opts.endpoint}`, {
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
