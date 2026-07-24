---
"@vercel/sandbox": minor
---

Support the sandbox fork API. Instead of implementing fork on the client-side, `Sandbox.fork()` now calls the `POST /v2/sandboxes/:name/fork` endpoint, which copies the source sandbox's env (and image) server-side.
