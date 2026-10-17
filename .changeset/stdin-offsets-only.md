---
"@vercel/sandbox": patch
---

Stdin writes now always send an offset, and a timed-out write that reports no progress is treated as stalled.
