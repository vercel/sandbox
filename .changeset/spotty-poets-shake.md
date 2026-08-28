---
"@vercel/sandbox": patch
---

Reject multiple `tags` filters on `Sandbox.list()` at the type level. The API supports filtering by a single tag, so passing more than one key in `tags` is now a compile-time error instead of a 400 from the API.
