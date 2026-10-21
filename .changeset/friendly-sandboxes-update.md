---
"@vercel/sandbox": patch
---

Apply network policy changes to active sessions before saving configuration and tags, and surface live policy failures so tags cannot incorrectly indicate that a failed policy update succeeded.

Skip live network policy updates for sessions that are already stopping so configuration can still be saved for the next session.
