export async function fetchApi(opts: { token: string; endpoint: string }) {
  const response = await fetch(`https://api.vercel.com${opts.endpoint}`, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
    },
  });
  if (!response.ok) {
    let message = await response.text();

    try {
      const { error } = JSON.parse(message);
      message = `${error.code.toUpperCase()}: ${error.message}`;
    } catch {}

    throw new Error(`HTTP ${response.status}: ${message}`, {
      cause: { statusCode: response.status, message: response.statusText },
    });
  }
  return await response.json();
}
