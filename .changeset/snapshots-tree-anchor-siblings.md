---
"@vercel/sandbox": patch
"sandbox": patch
---

Show the current snapshot's siblings in `snapshots tree`. The tree now reads the API's `anchor` node so snapshots sharing the current snapshot's parent are listed, and siblings are rendered by snapshot ID instead of source session ID.
