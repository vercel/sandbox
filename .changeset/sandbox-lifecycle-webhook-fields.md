---
"@vercel/sandbox": minor
---

Add `expiryNotificationLeadTime` to `Sandbox.create`, `Sandbox.fork` and `sandbox.update`, and expose it on `Sandbox`. It sets how long before a session times out, in milliseconds, the `sandbox.session.expiring` webhook is sent. Expose why a session stopped as `Session.stopReason`.
