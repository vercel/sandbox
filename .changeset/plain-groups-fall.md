---
"@vercel/sandbox": patch
---

Respect `Retry-After` when the value is up to 20 seconds. `Retry-After` values greater than 20 seconds will throw back the response to the client.
