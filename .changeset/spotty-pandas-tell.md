---
"sandbox": minor
---

Add opt-out usage telemetry and AI-agent attribution. The CLI now reports
anonymous usage events (subcommand, CLI version, platform, and the AI agent
driving the invocation, detected via `detect-agent`) to Vercel's telemetry
bridge, and tags API requests with the detected agent in the user-agent
header. Manage collection with `sandbox telemetry status|enable|disable`,
`VERCEL_SANDBOX_TELEMETRY_DISABLED=1`, or inspect events without sending via
`VERCEL_TELEMETRY_DEBUG=1`. Running as `vercel sandbox` respects the Vercel
CLI's own telemetry preference.
