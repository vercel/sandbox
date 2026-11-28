---
"@vercel/sandbox": patch
---

A `runCommand` that waits for its command now retries when it's rate limited (429), waiting at least the `Retry-After` and at most 20 seconds in total. It still doesn't retry network errors or 5xx responses, since the command may have started.
