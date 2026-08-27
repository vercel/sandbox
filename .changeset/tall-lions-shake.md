---
"@vercel/sandbox": minor
---

Tag API requests with the AI agent driving the process, when one is
detected via `detect-agent`, as an `agent/<name>` phrase in the user-agent
header. No agent detected means no change to the header. The SDK sends no
telemetry events; this is request metadata only.
