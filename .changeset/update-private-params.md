---
"@vercel/sandbox": patch
---

`sandbox.update()` passes private `__` parameters to the API, as `Sandbox.create()` and `Sandbox.fork()` do.
