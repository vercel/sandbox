---
"@vercel/sandbox": patch
---

Correct the `resume` option JSDoc on `Sandbox.get` and `Sandbox.getOrCreate`: the default is `false` (the client omits the param and the API defaults to not resuming), not `true`. A stopped sandbox still auto-resumes on the first SDK call that needs a running session.
