---
"@vercel/sandbox": patch
---

The `downloadFile` method now throws a clear error when src or dst path is missing, instead of failing with a cryptic exception.
