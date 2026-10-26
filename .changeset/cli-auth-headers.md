---
"sandbox": minor
"@vercel/sandbox": patch
---

`createApp` takes an optional `getAuthHeaders`, called for every API request (retries included) to send headers in place of `Authorization: Bearer`, such as a DPoP proof for a sender-constrained token. `inferScope` from `@vercel/sandbox/dist/auth` takes an optional `fetch`.
