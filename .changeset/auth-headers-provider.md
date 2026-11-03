---
"@vercel/sandbox": minor
"sandbox": minor
---

Add an optional `getAuthHeaders` option to authenticate API requests with custom headers instead of `Authorization: Bearer <token>`, such as a DPoP proof (RFC 9449). It's called for every request, retries included, with the request's method and URL, and an optional `onResponse` receives each response's headers. A request rejected with `use_dpop_nonce` is sent once more with new headers. `createApp` in `sandbox` accepts it too and uses it when no `--token` or `VERCEL_AUTH_TOKEN` is given.
