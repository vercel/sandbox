---
"sandbox": patch
---

Retry the interactive shell WebSocket open on connection failure so `sandbox connect` recovers when the sandbox-router cache is briefly stale after a named-sandbox resume.
