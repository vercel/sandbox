---
"@vercel/sandbox": patch
---

Reduce request latency: keep idle API connections alive for 60s instead of undici's 4s default, negotiate HTTP/2 and multiplex concurrent idempotent requests over one connection, and use undici's own `fetch` alongside its Agent instead of the runtime's built-in `fetch`.
