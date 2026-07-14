---
"@vercel/sandbox": minor
"sandbox": minor
---

Add a `status` filter (`running`, `stopping`, `stopped`) to `Sandbox.list`, forwarded to the API for correct pagination. The `sandbox ls` CLI now filters by `running` at the API level by default, adds a `--status` option, and keeps returning every status with `--all`.
