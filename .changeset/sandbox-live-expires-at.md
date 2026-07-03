---
"@vercel/sandbox": minor
"sandbox": minor
---

Report the live timeout deadline of running sandboxes. `Sandbox.list` and `Sandbox.get` now expose `expiresAt`, reflecting the current session's deadline including any timeout extensions, and `sandbox list` renders it in the `TIMEOUT` column. `Sandbox.update({ timeout })` (and `sandbox config timeout`) now also extends the currently running session so an increased timeout takes effect immediately instead of only applying to future sessions.
