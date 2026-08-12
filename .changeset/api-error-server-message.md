---
"@vercel/sandbox": patch
---

Surface the server's error message in `APIError.message`. Failed API requests previously reported only `Status code 400 is not ok`, hiding the actionable detail (e.g. ``Invalid request: `ports` should NOT have more than 15 items.``) in `error.json`. The message now includes it directly.
