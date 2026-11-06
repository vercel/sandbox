---
"@vercel/sandbox": patch
---

Reuse keep-alive connections for back-to-back API requests and call `https://api.vercel.com` directly, cutting connection setup and an extra edge hop from each sandbox create and command.
