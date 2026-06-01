---
"@vercel/sandbox": patch
---

Fix runCommand failures on Node 26+ caused by passing an undici@7 Agent to Node's built-in fetch, which broke brotli decompression and response headers on streaming API responses.
