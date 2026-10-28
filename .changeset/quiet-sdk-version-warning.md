---
"@vercel/sandbox": patch
"sandbox": patch
---

Warn once per process when the SDK is a stable major version behind npm's latest release. Check alongside the first API request, reuse an hourly cache, and keep registry failures from affecting Sandbox operations. Set `SANDBOX_SKIP_VERSION_CHECK=1` to disable the check. Custom fetch implementations and API URLs skip it.

Use the CLI transport for snapshot lookups so they retain the CLI user agent and skip SDK version checks.
