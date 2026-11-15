---
"@vercel/sandbox": patch
---

Fix the SDK failing to import on Bun, whose built-in `undici` module has no `Dispatcher1Wrapper` export.
