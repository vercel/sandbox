---
"sandbox": minor
---

Auto-resume stopped sandboxes from their most recent snapshot when using `sandbox connect` or `sandbox exec`. When a sandbox is stopped, the CLI now automatically looks for an existing snapshot and creates a new sandbox from it, instead of just showing an error.
