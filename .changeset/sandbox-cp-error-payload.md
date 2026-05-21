---
"@vercel/sandbox": patch
---

Fix `readFile` writing the API error JSON into the destination when the file response is not an octet-stream. The SDK now rejects any non-`application/octet-stream` response (including 2xx with a JSON error body) instead of piping it verbatim to the caller's stream.
