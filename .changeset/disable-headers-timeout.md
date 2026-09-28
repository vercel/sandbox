---
"@vercel/sandbox": patch
---

Disable `headersTimeout` on the default undici Agent so long-running `cmd.wait()` long-polls don't abort at undici's 5-minute default. Previously `bodyTimeout` was disabled but `headersTimeout` was left at the default, which cut off `cmd.wait()` when a sandbox command took longer than 5 minutes — even though the sandbox itself was still alive.
