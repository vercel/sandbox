---
"@vercel/sandbox": patch
---

`Snapshot.get` now forwards a custom `fetch` (via `WithFetchOptions`), matching `Snapshot.list` and `Snapshot.tree`. Previously it always used the global `fetch`, so an injected client could not intercept the request.
