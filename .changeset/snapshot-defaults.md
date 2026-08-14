---
"@vercel/sandbox": major
"@vercel/sandbox-mock": major
"sandbox": major
---

**Breaking:** adopt the new snapshot defaults. Snapshots now expire after 7 days by default instead of 30, and persistent sandboxes get a `{ count: 1, deleteEvicted: true }` retention policy unless one is given: only the most recent snapshot is kept, and taking a new one deletes the previous snapshot immediately instead of leaving it around until it expires. Pass `keepLastSnapshots: null` (CLI: `--keep-last-snapshots 0`) to keep every snapshot until it expires.
