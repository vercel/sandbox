---
"sandbox": patch
---

`create`, `sh`, and `run` check for a newer published CLI concurrently with sandbox creation (time-boxed, zero added latency) and print an update notice when the install is stale. Disable with `SANDBOX_SKIP_VERSION_CHECK=1`.
