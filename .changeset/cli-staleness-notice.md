---
"sandbox": patch
---

`create`, `sh`, and `run` check for a newer published CLI and print an update notice when the install is behind. The result is cached to a file and refreshed at most once per hour; when a lookup does run it happens concurrently with sandbox creation and is aborted as the command finishes, so it never adds latency or delays exit. Disable with `SANDBOX_SKIP_VERSION_CHECK=1`.
