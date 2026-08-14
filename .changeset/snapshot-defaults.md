---
"@vercel/sandbox": major
"@vercel/sandbox-mock": major
"sandbox": major
---

**\[Breaking\]** Reduced default snapshots retention:

- Snapshots now expire after 7 days by default instead of 30 days previously. You can keep using expiration to set a custom snapshot expiration window in milliseconds, or set it to 0 to disable expiration.
- Persistent sandboxes now preserve only the last session's snapshot by default, instead of the snapshot of each session. You can still set a custom retention policy via keepLastSnapshots.
